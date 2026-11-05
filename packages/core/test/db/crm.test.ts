import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { DateTime } from "luxon";
import { withTenant } from "../../src/db/tenant";
import { closeDb } from "../../src/db/client";
import { appointments, customers } from "../../src/db/schema";
import { createBooking, setAppointmentStatus } from "../../src/booking/service";
import { countCustomers, getCustomer, listCustomers } from "../../src/crm/customers";
import { createTestBusiness, dbAvailable, futureDate, localIso, TZ, type TestBusiness } from "../fixtures";

describe.skipIf(!dbAvailable())("CRM customer stats and segments", () => {
  let b: TestBusiness;
  let loyalId: string;
  let lapsedId: string;
  const actor = { type: "system" as const };

  beforeAll(async () => {
    b = await createTestBusiness();
    const longAgo = new Date("2020-01-01");
    const past = (daysAgo: number) => DateTime.now().setZone(TZ).minus({ days: daysAgo }).set({ hour: 10, minute: 0 }).toUTC().toISO()!;
    await withTenant(b.businessId, async (tx) => {
      const mk = (phone: string, name: string, startsAt: string) =>
        createBooking(tx, b.businessId, {
          serviceId: b.checkup.id,
          staffId: b.staff[0]!.id,
          startsAt,
          customer: { phone, name },
          source: "dashboard",
          actor,
          override: true,
          notifyCustomer: false,
          now: longAgo,
        });
      const a1 = await mk("+9613100001", "Loyal Lara", past(10));
      const a2 = await mk("+9613100001", "Loyal Lara", past(40));
      await setAppointmentStatus(tx, b.businessId, a1.id, "completed", actor);
      await setAppointmentStatus(tx, b.businessId, a2.id, "completed", actor);
      await mk("+9613100001", "Loyal Lara", localIso(futureDate(3), "11:00"));
      const l1 = await mk("+9613100002", "Lapsed Layal", past(300));
      await setAppointmentStatus(tx, b.businessId, l1.id, "completed", actor);
      const n1 = await mk("+9613100003", "No-show Nadim", past(5));
      await setAppointmentStatus(tx, b.businessId, n1.id, "no_show", actor);
      loyalId = a1.customerId;
      lapsedId = l1.customerId;
      await tx.update(customers).set({ tags: ["vip"] }).where(eq(customers.id, loyalId));
    });
  });
  afterAll(() => closeDb());

  it("computes visits and upcoming per customer (correlated subqueries are scoped correctly)", async () => {
    const loyal = await withTenant(b.businessId, (tx) => getCustomer(tx, b.businessId, loyalId));
    expect(loyal.visits).toBe(2);
    expect(loyal.upcoming).toBe(1);
    const all = await withTenant(b.businessId, (tx) => listCustomers(tx, b.businessId));
    const byName = Object.fromEntries(all.map((c) => [c.name, c]));
    expect(byName["Lapsed Layal"]!.visits).toBe(1);
    expect(byName["No-show Nadim"]!.visits).toBe(0);
    expect(byName["No-show Nadim"]!.noShowCount).toBe(1);
  });

  it("filters segments: lapsed, no-shows, tags, upcoming", async () => {
    const names = async (seg: Parameters<typeof listCustomers>[2]) =>
      (await withTenant(b.businessId, (tx) => listCustomers(tx, b.businessId, seg))).map((c) => c.name).sort();
    expect(await names({ noVisitDays: 180 })).toEqual(["Lapsed Layal"]);
    expect(await names({ minNoShows: 1 })).toEqual(["No-show Nadim"]);
    expect(await names({ tags: ["vip"] })).toEqual(["Loyal Lara"]);
    expect(await names({ hasUpcoming: true })).toEqual(["Loyal Lara"]);
    expect(await names({ search: "layal" })).toEqual(["Lapsed Layal"]);
    expect(await withTenant(b.businessId, (tx) => countCustomers(tx, b.businessId, { serviceIds: [b.checkup.id] }))).toBe(2);
    expect(lapsedId).toBeTruthy();
    const total = await withTenant(b.businessId, (tx) => tx.select().from(appointments));
    expect(total.length).toBe(5);
  });
});
