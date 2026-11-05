import { inject } from "vitest";
import { DateTime } from "luxon";
import { randomUUID } from "node:crypto";
import { withSystem, withTenant } from "../src/db/tenant";
import { createUser } from "../src/auth/users";
import { createBusiness, createService, createStaff, setWeeklyHours } from "../src/business/setup";
import { seedPlans } from "../src/db/seed";
import type { WeeklyRule } from "../src/availability/engine";

export const dbAvailable = () => inject("dbAvailable");

export const TZ = "Asia/Beirut";
export const ALL_WEEK_9_17: WeeklyRule[] = [1, 2, 3, 4, 5, 6, 7].map((weekday) => ({ weekday, start: "09:00", end: "17:00" }));

/** A local date a few days in the future (so min-notice/past rules never interfere). */
export function futureDate(daysAhead = 5): string {
  return DateTime.now().setZone(TZ).plus({ days: daysAhead }).toISODate()!;
}

export function localIso(date: string, clock: string): string {
  return DateTime.fromISO(`${date}T${clock}`, { zone: TZ }).toUTC().toISO()!;
}

export type TestBusiness = Awaited<ReturnType<typeof createTestBusiness>>;

export async function createTestBusiness(opts: { staffCount?: number; name?: string } = {}) {
  await seedPlans();
  const tag = randomUUID().slice(0, 8);
  const owner = await withSystem((tx) => createUser(tx, { email: `owner-${tag}@test.local`, password: "password123", name: "Owner" }));
  const business = await withSystem((tx) =>
    createBusiness(tx, { ownerUserId: owner.id, name: opts.name ?? `Test Clinic ${tag}`, vertical: "dental", withDefaultHours: false }),
  );
  const businessId = business.id;
  const result = await withTenant(businessId, async (tx) => {
    await setWeeklyHours(tx, businessId, null, ALL_WEEK_9_17);
    const staffMembers = [];
    for (let i = 0; i < (opts.staffCount ?? 2); i++) {
      staffMembers.push(await createStaff(tx, businessId, { name: `Staff ${i + 1}` }));
    }
    const checkup = await createService(tx, businessId, {
      name: { en: "Checkup", ar: "فحص" },
      durationMinutes: 30,
      priceCents: 4000,
      staffIds: staffMembers.map((s) => s.id),
    });
    const cleaning = await createService(tx, businessId, {
      name: { en: "Cleaning", ar: "تنظيف" },
      durationMinutes: 45,
      bufferAfterMinutes: 15,
      priceCents: 6000,
      staffIds: staffMembers.map((s) => s.id),
    });
    return { staff: staffMembers, checkup, cleaning };
  });
  return { owner, business, businessId, ...result };
}
