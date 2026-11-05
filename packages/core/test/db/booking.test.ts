import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq, sql } from "drizzle-orm";
import { withTenant } from "../../src/db/tenant";
import { closeDb } from "../../src/db/client";
import { appointments, customers, jobs } from "../../src/db/schema";
import {
  cancelBooking,
  createBooking,
  getAvailableSlots,
  rescheduleBooking,
  setAppointmentStatus,
  NOTIFY_JOB,
} from "../../src/booking/service";
import { DomainError } from "../../src/lib/errors";
import { createTestBusiness, dbAvailable, futureDate, localIso, type TestBusiness } from "../fixtures";

const user = (b: TestBusiness) => ({ type: "user" as const, userId: b.owner.id });
const customer = { phone: "+96170111222", name: "Rita Nassar", language: "ar" as const };

async function expectDomainError(p: Promise<unknown>, code: string, reason?: string) {
  try {
    await p;
  } catch (e) {
    expect(e).toBeInstanceOf(DomainError);
    expect((e as DomainError).code).toBe(code);
    if (reason) expect((e as DomainError).details?.reason).toBe(reason);
    return e as DomainError;
  }
  throw new Error(`expected DomainError ${code}`);
}

describe.skipIf(!dbAvailable())("booking service (Postgres)", () => {
  let b: TestBusiness;
  const date = futureDate(6);

  beforeAll(async () => {
    b = await createTestBusiness({ staffCount: 2 });
  });
  afterAll(() => closeDb());

  it("creates a booking and schedules confirmation + reminder jobs", async () => {
    const appt = await withTenant(b.businessId, (tx) =>
      createBooking(tx, b.businessId, {
        serviceId: b.checkup.id,
        staffId: b.staff[0]!.id,
        startsAt: localIso(date, "10:00"),
        customer,
        source: "booking_page",
        actor: { type: "customer" },
      }),
    );
    expect(appt.status).toBe("confirmed");
    expect(appt.endsAt.getTime() - appt.startsAt.getTime()).toBe(30 * 60_000);
    const queued = await withTenant(b.businessId, (tx) =>
      tx.select().from(jobs).where(and(eq(jobs.type, NOTIFY_JOB), sql`${jobs.payload}->>'appointmentId' = ${appt.id}`)),
    );
    const kinds = queued.map((j) => (j.payload as { kind: string }).kind).sort();
    expect(kinds).toEqual(["confirmation", "reminder", "reminder"]);
    const reminder24h = queued.find((j) => (j.payload as { offsetMinutes?: number }).offsetMinutes === 1440)!;
    expect(reminder24h.runAt.getTime()).toBe(appt.startsAt.getTime() - 24 * 3600_000);
  });

  it("rejects a double booking for the same staff and time", async () => {
    await expectDomainError(
      withTenant(b.businessId, (tx) =>
        createBooking(tx, b.businessId, {
          serviceId: b.checkup.id,
          staffId: b.staff[0]!.id,
          startsAt: localIso(date, "10:15"),
          customer: { phone: "+96103999888", name: "Other" },
          source: "booking_page",
          actor: { type: "customer" },
        }),
      ),
      "SLOT_UNAVAILABLE",
      "conflict",
    );
  });

  it("'any staff' assigns the free staff member", async () => {
    const appt = await withTenant(b.businessId, (tx) =>
      createBooking(tx, b.businessId, {
        serviceId: b.checkup.id,
        staffId: null,
        startsAt: localIso(date, "10:00"),
        customer: { phone: "+9613444555", name: "Elie" },
        source: "whatsapp",
        actor: { type: "ai" },
      }),
    );
    expect(appt.staffId).toBe(b.staff[1]!.id);
    // Now both are busy at 10:00.
    const slots = await withTenant(b.businessId, (tx) =>
      getAvailableSlots(tx, b.businessId, { serviceId: b.checkup.id, fromDate: date, toDate: date }),
    );
    expect(slots.find((s) => s.start === localIso(date, "10:00"))).toBeUndefined();
  });

  it("normalizes phone numbers so local and E.164 formats map to one customer", async () => {
    await withTenant(b.businessId, (tx) =>
      createBooking(tx, b.businessId, {
        serviceId: b.checkup.id,
        startsAt: localIso(date, "14:00"),
        customer: { phone: "70 111 222", name: "Someone else" },
        source: "booking_page",
        actor: { type: "customer" },
      }),
    );
    const rows = await withTenant(b.businessId, (tx) =>
      tx.select().from(customers).where(eq(customers.phone, "+96170111222")),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]!.name).toBe("Rita Nassar"); // existing record name is kept
  });

  it("rejects invalid phone numbers", async () => {
    await expectDomainError(
      withTenant(b.businessId, (tx) =>
        createBooking(tx, b.businessId, {
          serviceId: b.checkup.id,
          startsAt: localIso(date, "15:00"),
          customer: { phone: "12", name: "X" },
          source: "booking_page",
          actor: { type: "customer" },
        }),
      ),
      "VALIDATION",
    );
  });

  it("exactly one of two concurrent bookings for the same slot wins", async () => {
    const attempt = (phone: string) =>
      withTenant(b.businessId, (tx) =>
        createBooking(tx, b.businessId, {
          serviceId: b.checkup.id,
          staffId: b.staff[0]!.id,
          startsAt: localIso(date, "11:00"),
          customer: { phone, name: "Racer" },
          source: "booking_page",
          actor: { type: "customer" },
        }),
      );
    const results = await Promise.allSettled([attempt("+9613000001"), attempt("+9613000002")]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const rejected = results.find((r) => r.status === "rejected") as PromiseRejectedResult;
    expect((rejected.reason as DomainError).code).toBe("SLOT_UNAVAILABLE");
  });

  it("concurrent 'any staff' bookings fill each staff member exactly once", async () => {
    const attempt = (i: number) =>
      withTenant(b.businessId, (tx) =>
        createBooking(tx, b.businessId, {
          serviceId: b.checkup.id,
          startsAt: localIso(date, "12:00"),
          customer: { phone: `+96171000${String(i).padStart(3, "0")}`, name: `Racer ${i}` },
          source: "whatsapp",
          actor: { type: "ai" },
        }),
      );
    const results = await Promise.allSettled([0, 1, 2, 3, 4].map(attempt));
    const ok = results.filter((r) => r.status === "fulfilled") as PromiseFulfilledResult<{ staffId: string }>[];
    expect(ok).toHaveLength(2);
    expect(new Set(ok.map((r) => r.value.staffId)).size).toBe(2);
  });

  it("the DB exclusion constraint blocks overlaps even if app code is bypassed", async () => {
    const [existing] = await withTenant(b.businessId, (tx) =>
      tx.select().from(appointments).where(eq(appointments.startsAt, new Date(localIso(date, "11:00")))),
    );
    const raw = withTenant(b.businessId, (tx) =>
      tx.insert(appointments).values({
        ...existing!,
        id: undefined,
        startsAt: new Date(localIso(date, "11:10")),
        endsAt: new Date(localIso(date, "11:40")),
        createdAt: undefined,
        updatedAt: undefined,
      }),
    );
    await expect(raw).rejects.toMatchObject({ cause: { code: "23P01" } });
    // A cancelled appointment does not block.
    const cancelledInsert = await withTenant(b.businessId, (tx) =>
      tx
        .insert(appointments)
        .values({
          ...existing!,
          id: undefined,
          status: "cancelled",
          startsAt: new Date(localIso(date, "11:10")),
          endsAt: new Date(localIso(date, "11:40")),
          createdAt: undefined,
          updatedAt: undefined,
        })
        .returning(),
    );
    expect(cancelledInsert).toHaveLength(1);
  });

  it("buffers are enforced (cleaning has a 15 min after-buffer)", async () => {
    await withTenant(b.businessId, (tx) =>
      createBooking(tx, b.businessId, {
        serviceId: b.cleaning.id,
        staffId: b.staff[1]!.id,
        startsAt: localIso(date, "15:00"),
        customer: { phone: "+9613777666", name: "Buffer" },
        source: "dashboard",
        actor: user(b),
      }),
    );
    // Cleaning 15:00-15:45 + 15 min cleanup → 15:45 is blocked, 16:00 is free.
    await expectDomainError(
      withTenant(b.businessId, (tx) =>
        createBooking(tx, b.businessId, {
          serviceId: b.checkup.id,
          staffId: b.staff[1]!.id,
          startsAt: localIso(date, "15:45"),
          customer: { phone: "+9613777665", name: "Next" },
          source: "dashboard",
          actor: user(b),
        }),
      ),
      "SLOT_UNAVAILABLE",
      "conflict",
    );
    const ok = await withTenant(b.businessId, (tx) =>
      createBooking(tx, b.businessId, {
        serviceId: b.checkup.id,
        staffId: b.staff[1]!.id,
        startsAt: localIso(date, "16:00"),
        customer: { phone: "+9613777665", name: "Next" },
        source: "dashboard",
        actor: user(b),
      }),
    );
    expect(ok.id).toBeTruthy();
  });

  it("cancelling frees the slot and cancels pending reminders", async () => {
    const appt = await withTenant(b.businessId, (tx) =>
      createBooking(tx, b.businessId, {
        serviceId: b.checkup.id,
        staffId: b.staff[0]!.id,
        startsAt: localIso(date, "13:00"),
        customer: { phone: "+9613123123", name: "Cancel me" },
        source: "booking_page",
        actor: { type: "customer" },
      }),
    );
    await withTenant(b.businessId, (tx) => cancelBooking(tx, b.businessId, appt.id, { actor: user(b), reason: "test" }));
    const pending = await withTenant(b.businessId, (tx) =>
      tx
        .select()
        .from(jobs)
        .where(and(eq(jobs.status, "pending"), sql`${jobs.payload}->>'appointmentId' = ${appt.id}`)),
    );
    expect(pending.map((j) => (j.payload as { kind: string }).kind)).toEqual(["cancelled"]);
    const again = await withTenant(b.businessId, (tx) =>
      createBooking(tx, b.businessId, {
        serviceId: b.checkup.id,
        staffId: b.staff[0]!.id,
        startsAt: localIso(date, "13:00"),
        customer: { phone: "+9613123124", name: "Takes the slot" },
        source: "booking_page",
        actor: { type: "customer" },
      }),
    );
    expect(again.status).toBe("confirmed");
  });

  it("reschedules, refusing conflicts and replacing reminders", async () => {
    const appt = await withTenant(b.businessId, (tx) =>
      createBooking(tx, b.businessId, {
        serviceId: b.checkup.id,
        staffId: b.staff[0]!.id,
        startsAt: localIso(date, "09:00"),
        customer: { phone: "+9613555444", name: "Mover" },
        source: "booking_page",
        actor: { type: "customer" },
      }),
    );
    await expectDomainError(
      withTenant(b.businessId, (tx) =>
        rescheduleBooking(tx, b.businessId, appt.id, { startsAt: localIso(date, "10:00"), staffId: b.staff[0]!.id, actor: { type: "customer" } }),
      ),
      "SLOT_UNAVAILABLE",
    );
    const moved = await withTenant(b.businessId, (tx) =>
      rescheduleBooking(tx, b.businessId, appt.id, { startsAt: localIso(date, "16:30"), actor: { type: "customer" } }),
    );
    expect(moved.startsAt.toISOString()).toBe(localIso(date, "16:30"));
    const pendingReminders = await withTenant(b.businessId, (tx) =>
      tx
        .select()
        .from(jobs)
        .where(and(eq(jobs.status, "pending"), sql`${jobs.payload}->>'appointmentId' = ${appt.id}`, sql`${jobs.payload}->>'kind' = 'reminder'`)),
    );
    expect(pendingReminders).toHaveLength(2);
    expect(pendingReminders.every((j) => (j.payload as { expectedStartsAt: string }).expectedStartsAt === moved.startsAt.toISOString())).toBe(true);
    // Moving to the same time slot of itself is allowed (excludes itself).
    const same = await withTenant(b.businessId, (tx) =>
      rescheduleBooking(tx, b.businessId, appt.id, { startsAt: localIso(date, "16:15"), actor: { type: "customer" } }),
    );
    expect(same.startsAt.toISOString()).toBe(localIso(date, "16:15"));
  });

  it("dashboard override allows outside hours but never overlaps", async () => {
    const late = await withTenant(b.businessId, (tx) =>
      createBooking(tx, b.businessId, {
        serviceId: b.checkup.id,
        staffId: b.staff[0]!.id,
        startsAt: localIso(date, "19:00"),
        customer: { phone: "+9613888999", name: "After hours" },
        source: "dashboard",
        actor: user(b),
        override: true,
      }),
    );
    expect(late.id).toBeTruthy();
    await expectDomainError(
      withTenant(b.businessId, (tx) =>
        createBooking(tx, b.businessId, {
          serviceId: b.checkup.id,
          staffId: b.staff[0]!.id,
          startsAt: localIso(date, "19:15"),
          customer: { phone: "+9613888998", name: "Overlap" },
          source: "dashboard",
          actor: user(b),
          override: true,
        }),
      ),
      "SLOT_UNAVAILABLE",
      "conflict",
    );
    // Public channels can never override.
    await expectDomainError(
      withTenant(b.businessId, (tx) =>
        createBooking(tx, b.businessId, {
          serviceId: b.checkup.id,
          staffId: b.staff[1]!.id,
          startsAt: localIso(date, "20:00"),
          customer: { phone: "+9613888997", name: "Nope" },
          source: "booking_page",
          actor: { type: "customer" },
          override: true,
        }),
      ),
      "SLOT_UNAVAILABLE",
      "outside_hours",
    );
  });

  it("customers cannot cancel inside the cancellation notice window", async () => {
    const soonDate = futureDate(0);
    const startsAt = new Date(Date.now() + 3 * 3600_000);
    startsAt.setUTCMinutes(0, 0, 0);
    const appt = await withTenant(b.businessId, (tx) =>
      createBooking(tx, b.businessId, {
        serviceId: b.checkup.id,
        staffId: b.staff[0]!.id,
        startsAt,
        customer: { phone: "+9613222111", name: "Late" },
        source: "dashboard",
        actor: user(b),
        override: true,
      }),
    );
    expect(soonDate).toBeTruthy();
    await expectDomainError(
      withTenant(b.businessId, (tx) => cancelBooking(tx, b.businessId, appt.id, { actor: { type: "customer" } })),
      "TOO_LATE",
    );
    const byStaff = await withTenant(b.businessId, (tx) => cancelBooking(tx, b.businessId, appt.id, { actor: user(b) }));
    expect(byStaff.status).toBe("cancelled");
  });

  it("tracks no-shows and last visit", async () => {
    const appt = await withTenant(b.businessId, (tx) =>
      createBooking(tx, b.businessId, {
        serviceId: b.checkup.id,
        staffId: b.staff[1]!.id,
        startsAt: localIso(date, "09:00"),
        customer: { phone: "+9613666000", name: "No Show" },
        source: "dashboard",
        actor: user(b),
      }),
    );
    await withTenant(b.businessId, (tx) => setAppointmentStatus(tx, b.businessId, appt.id, "no_show", user(b)));
    let [c] = await withTenant(b.businessId, (tx) => tx.select().from(customers).where(eq(customers.id, appt.customerId)));
    expect(c!.noShowCount).toBe(1);
    await withTenant(b.businessId, (tx) => setAppointmentStatus(tx, b.businessId, appt.id, "completed", user(b)));
    [c] = await withTenant(b.businessId, (tx) => tx.select().from(customers).where(eq(customers.id, appt.customerId)));
    expect(c!.noShowCount).toBe(0);
    expect(c!.lastVisitAt?.toISOString()).toBe(appt.startsAt.toISOString());
  });
});
