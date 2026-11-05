import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { and, eq, sql } from "drizzle-orm";
import { getDb, closeDb } from "../../src/db/client";
import { withTenant } from "../../src/db/tenant";
import { jobs, notifications } from "../../src/db/schema";
import { createBooking, rescheduleBooking } from "../../src/booking/service";
import { enqueueJob, registerJobHandler, runDueJobs } from "../../src/jobs/queue";
import { registerDefaultJobHandlers } from "../../src/jobs/handlers";
import { MockWhatsAppProvider } from "../../src/providers/whatsapp/mock";
import { setProviders } from "../../src/providers";
import { createTestBusiness, dbAvailable, futureDate, localIso, type TestBusiness } from "../fixtures";

describe.skipIf(!dbAvailable())("job queue + notifications", () => {
  let b: TestBusiness;
  let wa: MockWhatsAppProvider;

  beforeAll(async () => {
    registerDefaultJobHandlers();
    b = await createTestBusiness();
  });
  beforeEach(async () => {
    wa = new MockWhatsAppProvider();
    setProviders({ whatsapp: wa });
    // Isolate: park every other pending job far in the future.
    await getDb().update(jobs).set({ runAt: new Date("2100-01-01") }).where(eq(jobs.status, "pending"));
  });
  afterAll(() => closeDb());

  it("sends the booking confirmation via WhatsApp in the customer's language", async () => {
    const appt = await withTenant(b.businessId, (tx) =>
      createBooking(tx, b.businessId, {
        serviceId: b.checkup.id,
        startsAt: localIso(futureDate(3), "10:00"),
        customer: { phone: "+96170123123", name: "Layal Sfeir", language: "ar" },
        source: "booking_page",
        actor: { type: "customer" },
      }),
    );
    const res = await runDueJobs();
    expect(res.processed).toBeGreaterThanOrEqual(1);
    expect(wa.outbox).toHaveLength(1);
    expect(wa.outbox[0]!.to).toBe("+96170123123");
    expect(wa.outbox[0]!.body).toContain("Layal");
    expect(wa.outbox[0]!.body).toContain("فحص");
    expect(wa.outbox[0]!.body).toContain("/manage/");
    const [n] = await withTenant(b.businessId, (tx) => tx.select().from(notifications).where(eq(notifications.appointmentId, appt.id)));
    expect(n!.status).toBe("sent");
    expect(n!.templateName).toBe("appointment_confirmation");
    expect(n!.language).toBe("ar");
  });

  it("a due reminder is skipped when the appointment moved", async () => {
    const date = futureDate(3);
    const appt = await withTenant(b.businessId, (tx) =>
      createBooking(tx, b.businessId, {
        serviceId: b.checkup.id,
        startsAt: localIso(date, "11:00"),
        customer: { phone: "+96170123124", name: "Mover", language: "en" },
        source: "booking_page",
        actor: { type: "customer" },
        notifyCustomer: false,
      }),
    );
    // Stale reminder that still points at the old time.
    await withTenant(b.businessId, (tx) =>
      enqueueJob(tx, {
        type: "notify.appointment",
        businessId: b.businessId,
        payload: { appointmentId: appt.id, kind: "reminder", expectedStartsAt: "2000-01-01T00:00:00.000Z" },
      }),
    );
    await runDueJobs();
    expect(wa.outbox).toHaveLength(0);
    const [job] = await getDb()
      .select()
      .from(jobs)
      .where(and(sql`${jobs.payload}->>'appointmentId' = ${appt.id}`, eq(jobs.status, "done")));
    expect(job!.lastError).toContain("moved");
    // And a real reschedule replaces pending reminders.
    await withTenant(b.businessId, (tx) =>
      rescheduleBooking(tx, b.businessId, appt.id, { startsAt: localIso(date, "15:00"), actor: { type: "customer" }, notifyCustomer: false }),
    );
  });

  it("retries failing jobs with backoff and gives up after max attempts", async () => {
    let calls = 0;
    registerJobHandler("test.flaky", async () => {
      calls++;
      throw new Error("boom");
    });
    await getDb().insert(jobs).values({ type: "test.flaky", maxAttempts: 2, payload: {} });
    await runDueJobs();
    let [j] = await getDb().select().from(jobs).where(eq(jobs.type, "test.flaky"));
    expect(j!.status).toBe("pending");
    expect(j!.attempts).toBe(1);
    expect(j!.runAt.getTime()).toBeGreaterThan(Date.now());
    await getDb().update(jobs).set({ runAt: new Date() }).where(eq(jobs.id, j!.id));
    await runDueJobs();
    [j] = await getDb().select().from(jobs).where(eq(jobs.type, "test.flaky"));
    expect(j!.status).toBe("failed");
    expect(j!.lastError).toBe("boom");
    expect(calls).toBe(2);
  });

  it("dedupe keys prevent duplicate jobs", async () => {
    await withTenant(b.businessId, async (tx) => {
      await enqueueJob(tx, { type: "test.noop", businessId: b.businessId, dedupeKey: "same-key" });
      await enqueueJob(tx, { type: "test.noop", businessId: b.businessId, dedupeKey: "same-key" });
    });
    const rows = await getDb().select().from(jobs).where(eq(jobs.dedupeKey, "same-key"));
    expect(rows).toHaveLength(1);
  });
});
