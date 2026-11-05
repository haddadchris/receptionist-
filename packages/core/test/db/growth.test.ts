import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { and, asc, desc, eq } from "drizzle-orm";
import { DateTime } from "luxon";
import { closeDb } from "../../src/db/client";
import { withSystem, withTenant } from "../../src/db/tenant";
import { appointments, businesses, campaigns, customers, jobs, messages, notifications, payments, reviewRequests, services, type Job } from "../../src/db/schema";
import { setProviders } from "../../src/providers";
import { MockWhatsAppProvider } from "../../src/providers/whatsapp/mock";
import { ingestWhatsAppWebhook, processWhatsAppConversation, simulatedInbound } from "../../src/channels/whatsapp";
import { setLLMProvider, MockLLMProvider } from "../../src/agent/llm";
import { createBooking, setAppointmentStatus } from "../../src/booking/service";
import { handleAppointmentNotification } from "../../src/notifications/send";
import { DEPOSIT_EXPIRE_JOB, depositRequirement } from "../../src/booking/deposit-rules";
import { handleDepositExpireJob, markDepositPaid, waiveDeposit } from "../../src/growth/deposits";
import { handleReviewRequestJob, parseRating, REVIEW_REQUEST_JOB } from "../../src/growth/reviews";
import { handleRecallJob, RECALL_JOB } from "../../src/growth/recalls";
import { CAMPAIGN_JOB, createCampaign, handleCampaignJob, previewAudience, scheduleCampaign } from "../../src/growth/campaigns";
import { getAnalytics } from "../../src/growth/analytics";
import { customerTimeline } from "../../src/crm/timeline";
import { executeTool, type ToolContext } from "../../src/agent/tools";
import { getBusiness } from "../../src/availability/loader";
import { createTestBusiness, dbAvailable, futureDate, localIso, type TestBusiness } from "../fixtures";

const STAFF = { type: "system", label: "test" } as const;

/** Run the pending job of `type` for this business (directly, like the worker would). */
async function runJob(businessId: string, type: string, handler: (job: Job) => Promise<unknown>, match?: (j: Job) => boolean) {
  const rows = await withSystem((tx) =>
    tx.select().from(jobs).where(and(eq(jobs.businessId, businessId), eq(jobs.type, type), eq(jobs.status, "pending"))).orderBy(desc(jobs.createdAt)),
  );
  const job = rows.find((j) => (match ? match(j) : true));
  if (!job) throw new Error(`no pending ${type} job`);
  const out = await handler(job);
  await withSystem((tx) => tx.update(jobs).set({ status: "done" }).where(eq(jobs.id, job.id)));
  return { job, out };
}

describe.skipIf(!dbAvailable())("growth layer", () => {
  let b: TestBusiness;
  let wa: MockWhatsAppProvider;
  const PHONE_ID = `growth-wa-${Date.now()}`;
  let seq = 0;
  const phone = () => `+96171${String((Date.now() + seq++ * 7919) % 1000000).padStart(6, "0")}`;

  beforeAll(async () => {
    b = await createTestBusiness({ name: "Growth Clinic" });
    await withSystem((tx) =>
      tx
        .update(businesses)
        .set({ whatsappPhoneNumberId: PHONE_ID, status: "active", googleReviewUrl: "https://g.page/r/growth-test/review" })
        .where(eq(businesses.id, b.businessId)),
    );
    setLLMProvider(new MockLLMProvider());
  });
  beforeEach(() => {
    wa = new MockWhatsAppProvider();
    setProviders({ whatsapp: wa });
  });
  afterAll(async () => {
    setLLMProvider(null);
    // Leave no due jobs behind for later test files that drain the shared queue.
    await withSystem((tx) => tx.update(jobs).set({ status: "cancelled" }).where(eq(jobs.status, "pending")));
    await closeDb();
  });

  async function send(from: string, text: string) {
    const res = await ingestWhatsAppWebhook(simulatedInbound({ phoneNumberId: PHONE_ID, from, text, name: "Growth Person" }));
    for (const c of res.conversations) await processWhatsAppConversation(c.businessId, c.conversationId);
    return res.conversations[0]!.conversationId;
  }
  const book = (opts: { serviceId?: string; day?: number; time: string; phone: string; source?: "booking_page" | "dashboard" | "whatsapp"; name?: string }) =>
    withTenant(b.businessId, (tx) =>
      createBooking(tx, b.businessId, {
        serviceId: opts.serviceId ?? b.checkup.id,
        startsAt: localIso(futureDate(opts.day ?? 4), opts.time),
        customer: { phone: opts.phone, name: opts.name ?? "Growth Customer", language: "en" },
        source: opts.source ?? "booking_page",
        actor: opts.source === "dashboard" ? STAFF : { type: "customer" },
      }),
    );

  describe("deposits", () => {
    beforeAll(async () => {
      await withTenant(b.businessId, (tx) => tx.update(services).set({ depositRequired: true, depositCents: 2000 }).where(eq(services.id, b.cleaning.id)));
    });

    it("holds public bookings as pending until the deposit is received", async () => {
      const p = phone();
      const appt = await book({ serviceId: b.cleaning.id, time: "10:00", phone: p });
      expect(appt.status).toBe("pending");
      expect(appt.depositStatus).toBe("required");
      expect(appt.depositCents).toBe(2000);
      expect(appt.depositDueAt!.getTime()).toBeLessThan(appt.startsAt.getTime());
      const [pay] = await withTenant(b.businessId, (tx) => tx.select().from(payments).where(eq(payments.appointmentId, appt.id)));
      expect(pay).toMatchObject({ kind: "deposit", status: "pending", amountCents: 2000 });

      // The deposit request goes out on WhatsApp with amount, instructions and reference.
      await runJob(b.businessId, "notify.appointment", handleAppointmentNotification, (j) => (j.payload as { appointmentId: string; kind: string }).appointmentId === appt.id && (j.payload as { kind: string }).kind === "deposit_request");
      expect(wa.outbox.at(-1)!.body).toContain("$20");
      expect(wa.outbox.at(-1)!.body).toContain(`D-${appt.id.slice(0, 6).toUpperCase()}`);

      const paid = await withTenant(b.businessId, (tx) => markDepositPaid(tx, b.businessId, appt.id, { method: "wallet", reference: "WHISH-9", actor: STAFF }));
      expect(paid.status).toBe("confirmed");
      expect(paid.depositStatus).toBe("paid");
      const [after] = await withTenant(b.businessId, (tx) => tx.select().from(payments).where(eq(payments.appointmentId, appt.id)));
      expect(after).toMatchObject({ status: "succeeded", method: "wallet", providerRef: "WHISH-9" });
      // Expiry job was cancelled.
      const exp = await withSystem((tx) => tx.select().from(jobs).where(and(eq(jobs.type, DEPOSIT_EXPIRE_JOB), eq(jobs.status, "pending"))));
      expect(exp.some((j) => (j.payload as { appointmentId: string }).appointmentId === appt.id)).toBe(false);
    });

    it("auto-cancels unpaid holds and frees the slot", async () => {
      const appt = await book({ serviceId: b.cleaning.id, time: "12:00", phone: phone() });
      await withTenant(b.businessId, (tx) => tx.update(appointments).set({ depositDueAt: new Date(Date.now() - 1000) }).where(eq(appointments.id, appt.id)));
      await runJob(b.businessId, DEPOSIT_EXPIRE_JOB, handleDepositExpireJob, (j) => (j.payload as { appointmentId: string }).appointmentId === appt.id);
      const [row] = await withTenant(b.businessId, (tx) => tx.select().from(appointments).where(eq(appointments.id, appt.id)));
      expect(row!.status).toBe("cancelled");
      expect(row!.cancelReason).toMatch(/Deposit not received/);
      // Same slot is bookable again.
      const again = await book({ serviceId: b.checkup.id, time: "12:00", phone: phone() });
      expect(again.id).toBeTruthy();
    });

    it("staff bookings skip deposits; staff can waive one", async () => {
      const staffBooked = await book({ serviceId: b.cleaning.id, time: "14:00", phone: phone(), source: "dashboard" });
      expect(staffBooked.depositStatus).toBe("none");
      expect(staffBooked.status).toBe("confirmed");
      const held = await book({ serviceId: b.cleaning.id, time: "16:00", phone: phone() });
      const waived = await withTenant(b.businessId, (tx) => waiveDeposit(tx, b.businessId, held.id, STAFF));
      expect(waived).toMatchObject({ status: "confirmed", depositStatus: "waived" });
    });

    it("requires a deposit from repeat no-shows", () => {
      const biz = { planTier: "premium" as const, featureFlags: {}, bookingSettings: { depositAfterNoShows: 2 } as never };
      const svc = { depositRequired: false, depositCents: 0, priceCents: 8000 };
      expect(depositRequirement(biz, svc, { noShowCount: 1 })).toBeNull();
      expect(depositRequirement(biz, svc, { noShowCount: 2 })).toEqual({ cents: 2500, reason: "no_shows" });
      expect(depositRequirement({ ...biz, featureFlags: { deposits: false } }, svc, { noShowCount: 5 })).toBeNull();
    });

    it("the AI tells the customer the slot is held, never 'confirmed'", async () => {
      const biz = await withTenant(b.businessId, (tx) => getBusiness(tx, b.businessId));
      const out = await withTenant(b.businessId, (tx) => {
        const ctx: ToolContext = {
          tx,
          business: biz,
          channel: "whatsapp",
          conversationId: null,
          verifiedPhone: phone(),
          customerId: null,
          customerName: "Rania",
          language: "en",
          state: {},
          now: new Date(),
          effects: { bookedAppointmentIds: [], rescheduledAppointmentIds: [], cancelledAppointmentIds: [] },
        } as unknown as ToolContext;
        return executeTool(ctx, "create_booking", { service_id: b.cleaning.id, start: `${futureDate(5)}T11:00` });
      });
      expect(out.output).toMatchObject({ ok: true, status: "pending", deposit_required: true, deposit: "$20" });
      expect(String((out.output as { note: string }).note)).toMatch(/NOT confirmed/);
    });
  });

  describe("reviews", () => {
    async function completedVisit(p: string) {
      const appt = await book({ time: "09:00", day: 6, phone: p, source: "dashboard" });
      await withTenant(b.businessId, (tx) => setAppointmentStatus(tx, b.businessId, appt.id, "completed", STAFF));
      await runJob(b.businessId, REVIEW_REQUEST_JOB, handleReviewRequestJob, (j) => (j.payload as { appointmentId: string }).appointmentId === appt.id);
      return appt;
    }

    it("parses ratings in Arabic and Latin digits and stars", () => {
      expect(parseRating("5")).toBe(5);
      expect(parseRating("٤")).toBe(4);
      expect(parseRating("4/5")).toBe(4);
      expect(parseRating("⭐⭐⭐")).toBe(3);
      expect(parseRating("5 stars please")).toBeNull();
      expect(parseRating("12")).toBeNull();
    });

    it("4–5 → thanks + Google review link", async () => {
      const p = phone();
      const appt = await completedVisit(p);
      expect(wa.outbox.at(-1)!.body).toMatch(/1 to 5/);
      await send(p, "5");
      expect(wa.outbox.at(-1)!.body).toContain("https://g.page/r/growth-test/review");
      const [rr] = await withTenant(b.businessId, (tx) => tx.select().from(reviewRequests).where(eq(reviewRequests.appointmentId, appt.id)));
      expect(rr).toMatchObject({ rating: 5, status: "rated" });
    });

    it("1–3 → private feedback to the owner (works even with AI paused)", async () => {
      await withSystem((tx) => tx.update(businesses).set({ status: "paused" }).where(eq(businesses.id, b.businessId)));
      try {
        const p = phone();
        const appt = await completedVisit(p);
        await send(p, "2");
        expect(wa.outbox.at(-1)!.body).toMatch(/what went wrong/i);
        const convoId = await send(p, "Waited 40 minutes past my time");
        expect(wa.outbox.at(-1)!.body).toMatch(/feedback/i);
        const [rr] = await withTenant(b.businessId, (tx) => tx.select().from(reviewRequests).where(eq(reviewRequests.appointmentId, appt.id)));
        expect(rr).toMatchObject({ rating: 2, status: "rated", feedback: "Waited 40 minutes past my time" });
        const thread = await withTenant(b.businessId, (tx) => tx.select().from(messages).where(eq(messages.conversationId, convoId)).orderBy(asc(messages.createdAt)));
        expect(thread.some((m) => m.contentType === "event" && /private feedback/.test(m.body ?? ""))).toBe(true);
        expect(wa.outbox.at(-1)!.body).not.toContain("g.page");
      } finally {
        await withSystem((tx) => tx.update(businesses).set({ status: "active" }).where(eq(businesses.id, b.businessId)));
      }
    });
  });

  describe("recalls", () => {
    beforeAll(async () => {
      await withTenant(b.businessId, (tx) => tx.update(services).set({ recallIntervalDays: 180 }).where(eq(services.id, b.checkup.id)));
    });

    it("schedules a recall after a completed visit and sends it when the customer hasn't rebooked", async () => {
      const p = phone();
      const appt = await book({ time: "15:00", day: 7, phone: p, source: "dashboard" });
      await withTenant(b.businessId, (tx) => setAppointmentStatus(tx, b.businessId, appt.id, "completed", STAFF));
      const { job } = await runJob(b.businessId, RECALL_JOB, handleRecallJob, (j) => (j.payload as { appointmentId: string }).appointmentId === appt.id);
      const days = DateTime.fromJSDate(job.runAt).diff(DateTime.fromJSDate(appt.startsAt), "days").days;
      expect(days).toBeGreaterThan(179);
      expect(days).toBeLessThan(182);
      expect(wa.outbox.at(-1)!.body).toMatch(/time for your next Checkup/);
    });

    it("skips the recall when the customer already has an upcoming appointment", async () => {
      const p = phone();
      const appt = await book({ time: "16:00", day: 7, phone: p, source: "dashboard" });
      await withTenant(b.businessId, (tx) => setAppointmentStatus(tx, b.businessId, appt.id, "completed", STAFF));
      await book({ time: "09:30", day: 9, phone: p, source: "dashboard" });
      const before = wa.outbox.length;
      const { out } = await runJob(b.businessId, RECALL_JOB, handleRecallJob, (j) => (j.payload as { appointmentId: string }).appointmentId === appt.id);
      expect(out).toEqual({ skipped: "already has an upcoming appointment" });
      expect(wa.outbox.length).toBe(before);
    });
  });

  describe("campaigns", () => {
    it("sends only to customers with marketing consent, once, and honours STOP", async () => {
      const tag = `promo-${Date.now()}`;
      const mk = async (consentMarketing: boolean, optedOut = false) => {
        const p = phone();
        await withTenant(b.businessId, (tx) =>
          tx.insert(customers).values({ businessId: b.businessId, phone: p, name: "Camp", tags: [tag], consentMarketing, optedOutAt: optedOut ? new Date() : null }),
        );
        return p;
      };
      const yes1 = await mk(true);
      const yes2 = await mk(true);
      await mk(false);
      await mk(true, true);
      const preview = await withTenant(b.businessId, (tx) => previewAudience(tx, b.businessId, { tags: [tag] }));
      expect(preview).toEqual({ matched: 4, eligible: 2 });

      const c = await withTenant(b.businessId, (tx) => createCampaign(tx, b.businessId, { name: "Ramadan offer", segment: { tags: [tag] }, message: "20% off whitening\nthis week" }, STAFF));
      expect(c.variables.message).toBe("20% off whitening this week");
      await withTenant(b.businessId, (tx) => scheduleCampaign(tx, b.businessId, c.id, null, STAFF));
      await runJob(b.businessId, CAMPAIGN_JOB, handleCampaignJob, (j) => (j.payload as { campaignId: string }).campaignId === c.id);
      const [done] = await withTenant(b.businessId, (tx) => tx.select().from(campaigns).where(eq(campaigns.id, c.id)));
      expect(done).toMatchObject({ status: "sent", sentCount: 2, recipientCount: 2 });
      const sentTo = wa.outbox.filter((m) => m.body.includes("20% off whitening")).map((m) => m.to);
      expect(new Set(sentTo)).toEqual(new Set([yes1, yes2]));
      expect(wa.outbox.find((m) => m.to === yes1)!.body).toMatch(/STOP/);
      const rows = await withTenant(b.businessId, (tx) => tx.select().from(notifications).where(eq(notifications.campaignId, c.id)));
      expect(rows).toHaveLength(2);

      // STOP → opted out, excluded from the next campaign.
      await send(yes1, "STOP");
      const after = await withTenant(b.businessId, (tx) => previewAudience(tx, b.businessId, { tags: [tag] }));
      expect(after.eligible).toBe(1);
    });
  });

  describe("no-show reduction", () => {
    it("'reply 1 to confirm' works on Basic (no AI) and '2' sends the reschedule link", async () => {
      const basic = await createTestBusiness({ name: "Basic Clinic" });
      const basicPhoneId = `basic-wa-${Date.now()}`;
      await withSystem((tx) => tx.update(businesses).set({ whatsappPhoneNumberId: basicPhoneId, planTier: "basic", status: "active" }).where(eq(businesses.id, basic.businessId)));
      const p = phone();
      const appt = await withTenant(basic.businessId, (tx) =>
        createBooking(tx, basic.businessId, { serviceId: basic.checkup.id, startsAt: localIso(futureDate(3), "10:00"), customer: { phone: p, name: "Basic Customer", language: "en" }, source: "booking_page", actor: { type: "customer" }, notifyCustomer: false }),
      );
      const { getOrCreateConversation, appendMessage } = await import("../../src/agent/conversations");
      const remind = () =>
        withTenant(basic.businessId, async (tx) => {
          const c = await getOrCreateConversation(tx, basic.businessId, { channel: "whatsapp", externalId: p, customerId: appt.customerId });
          await appendMessage(tx, { businessId: basic.businessId, conversationId: c.id, direction: "outbound", sender: "system", contentType: "template", body: "Reminder 🗓️ … Reply 1 to confirm or 2 to reschedule." });
        });
      const sendBasic = async (text: string) => {
        const res = await ingestWhatsAppWebhook(simulatedInbound({ phoneNumberId: basicPhoneId, from: p, text }));
        for (const c of res.conversations) await processWhatsAppConversation(c.businessId, c.conversationId);
      };
      await remind();
      await sendBasic("2");
      expect(wa.outbox.at(-1)!.body).toMatch(/pick a new time here: http/);
      await remind();
      await sendBasic("1");
      expect(wa.outbox.at(-1)!.body).toMatch(/confirmed/i);
      const [row] = await withTenant(basic.businessId, (tx) => tx.select().from(appointments).where(eq(appointments.id, appt.id)));
      expect(row!.customerConfirmedAt).not.toBeNull();
      // Free text gets no AI reply on Basic.
      const before = wa.outbox.length;
      await sendBasic("hello, do you have parking?");
      expect(wa.outbox.length).toBe(before);
    });
  });

  describe("analytics + timeline", () => {
    it("reports bookings by source, no-show rate, AI bookings and reviews", async () => {
      const from = DateTime.now().minus({ days: 1 }).toJSDate();
      const to = DateTime.now().plus({ days: 30 }).toJSDate();
      const a = await withTenant(b.businessId, (tx) => getAnalytics(tx, b.businessId, { from, to, timezone: "Asia/Beirut" }));
      expect(a.totalBookings).toBeGreaterThan(5);
      expect(a.bookingsBySource.find((s) => s.source === "booking_page")!.count).toBeGreaterThan(0);
      expect(a.ai.bookings).toBeGreaterThanOrEqual(1); // the AI tool booking above
      expect(a.reviews.count).toBeGreaterThanOrEqual(2);
      expect(a.reviews.positive).toBeGreaterThanOrEqual(1);
      expect(a.reviews.negative).toBeGreaterThanOrEqual(1);
      expect(a.deposits.expired).toBeGreaterThanOrEqual(1);
      expect(a.conversations.total).toBeGreaterThan(0);
      expect(a.busiest.length).toBeGreaterThan(0);
    });

    it("builds a customer timeline across appointments, messages and reviews", async () => {
      const [rr] = await withTenant(b.businessId, (tx) => tx.select().from(reviewRequests).where(eq(reviewRequests.rating, 5)).limit(1));
      const items = await withTenant(b.businessId, (tx) => customerTimeline(tx, b.businessId, rr!.customerId));
      const kinds = new Set(items.map((i) => i.kind));
      expect(kinds.has("appointment")).toBe(true);
      expect(kinds.has("notification")).toBe(true);
      expect(kinds.has("review")).toBe(true);
      expect(kinds.has("conversation")).toBe(true);
      // Sorted newest first.
      for (let i = 1; i < items.length; i++) expect(items[i - 1]!.at.getTime()).toBeGreaterThanOrEqual(items[i]!.at.getTime());
    });
  });
});
