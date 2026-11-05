/**
 * Business lifecycle: creation (onboarding), catalog (services/staff), hours.
 */
import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";
import { DateTime } from "luxon";
import type { Tx } from "../db/tenant";
import {
  breaks,
  businesses,
  DEFAULT_AI_SETTINGS,
  DEFAULT_BOOKING_SETTINGS,
  holidays,
  locations,
  memberships,
  plans,
  services,
  staff,
  staffServices,
  subscriptions,
  timeOff,
  workingHours,
  type Business,
  type Locale,
  type LocalizedText,
  type PlanTier,
  type Service,
  type Staff,
} from "../db/schema";
import type { WeeklyRule } from "../availability/engine";
import { DomainError } from "../lib/errors";
import { audit, type Actor } from "../lib/audit";
import { STAFF_COLORS, VERTICAL_PRESETS, type Vertical } from "./presets";

export const TRIAL_DAYS = 14;

const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{1,46}[a-z0-9])?$/;
const RESERVED_SLUGS = new Set(["admin", "api", "app", "dashboard", "login", "signup", "b", "demo", "www", "help", "support"]);

export function slugify(input: string): string {
  return input
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}

export function isValidSlug(slug: string): boolean {
  return SLUG_RE.test(slug) && !RESERVED_SLUGS.has(slug);
}

/** System tx: find a free slug based on the business name. */
export async function uniqueSlug(tx: Tx, base: string): Promise<string> {
  let root = slugify(base);
  if (root.length < 3) root = `business-${Math.random().toString(36).slice(2, 7)}`;
  if (RESERVED_SLUGS.has(root)) root = `${root}-clinic`;
  for (let i = 0; i < 50; i++) {
    const candidate = i === 0 ? root : `${root}-${i + 1}`;
    const [exists] = await tx.select({ id: businesses.id }).from(businesses).where(eq(businesses.slug, candidate));
    if (!exists) return candidate;
  }
  return `${root}-${Date.now().toString(36)}`;
}

export type CreateBusinessInput = {
  ownerUserId: string;
  name: string;
  slug?: string;
  vertical: Vertical;
  timezone?: string;
  defaultLanguage?: Locale;
  languages?: Locale[];
  phone?: string | null;
  email?: string | null;
  address?: string | null;
  city?: string | null;
  planTier?: PlanTier;
  /** Add the vertical's default opening hours. */
  withDefaultHours?: boolean;
};

/** System tx (the tenant does not exist yet). */
export async function createBusiness(tx: Tx, input: CreateBusinessInput): Promise<Business> {
  const name = input.name.trim();
  if (name.length < 2) throw new DomainError("VALIDATION", "Business name is required", { field: "name" });
  let slug = input.slug ? slugify(input.slug) : await uniqueSlug(tx, name);
  if (input.slug) {
    if (!isValidSlug(slug)) throw new DomainError("VALIDATION", "Invalid link name", { field: "slug" });
    const [exists] = await tx.select({ id: businesses.id }).from(businesses).where(eq(businesses.slug, slug));
    if (exists) slug = await uniqueSlug(tx, slug);
  }
  const tier = input.planTier ?? "premium";
  const trialEndsAt = DateTime.now().plus({ days: TRIAL_DAYS }).toJSDate();
  const [plan] = await tx.select().from(plans).where(eq(plans.tier, tier));
  const [biz] = await tx
    .insert(businesses)
    .values({
      name,
      slug,
      vertical: input.vertical,
      timezone: input.timezone ?? "Asia/Beirut",
      defaultLanguage: input.defaultLanguage ?? "ar",
      languages: input.languages ?? ["ar", "en", "fr"],
      phone: input.phone ?? null,
      email: input.email ?? null,
      address: input.address ?? null,
      city: input.city ?? null,
      planTier: tier,
      status: "trial",
      trialEndsAt,
      featureFlags: {},
      aiSettings: DEFAULT_AI_SETTINGS,
      bookingSettings: DEFAULT_BOOKING_SETTINGS,
    })
    .returning();
  const business = biz!;
  await tx.insert(memberships).values({ userId: input.ownerUserId, businessId: business.id, role: "owner" });
  await tx.insert(locations).values({ businessId: business.id, name, address: input.address ?? null, isDefault: true });
  await tx.insert(subscriptions).values({
    businessId: business.id,
    planTier: tier,
    status: "trialing",
    setupFeeCents: plan?.setupFeeCents ?? 0,
    monthlyFeeCents: plan?.monthlyFeeCents ?? 0,
    trialEndsAt,
  });
  if (input.withDefaultHours !== false) {
    await setWeeklyHours(tx, business.id, null, VERTICAL_PRESETS[input.vertical].hours);
  }
  await audit(tx, {
    businessId: business.id,
    actor: { type: "user", userId: input.ownerUserId },
    action: "business.created",
    entityType: "business",
    entityId: business.id,
    changes: { name, slug, vertical: input.vertical, tier },
  });
  return business;
}

// ---------------------------------------------------------------------------
// Hours
// ---------------------------------------------------------------------------

const CLOCK_RE = /^([01]\d|2[0-4]):[0-5]\d$/;

export function validateRules(rules: WeeklyRule[]): void {
  for (const r of rules) {
    if (!Number.isInteger(r.weekday) || r.weekday < 1 || r.weekday > 7) throw new DomainError("VALIDATION", "Invalid weekday");
    if (!CLOCK_RE.test(r.start) || !CLOCK_RE.test(r.end)) throw new DomainError("VALIDATION", "Invalid time (HH:mm)");
    if (r.end <= r.start) throw new DomainError("VALIDATION", "End time must be after start time");
  }
}

/** Replace weekly hours for the business (staffId null) or one staff member. */
export async function setWeeklyHours(tx: Tx, businessId: string, staffId: string | null, rules: WeeklyRule[]): Promise<void> {
  validateRules(rules);
  await tx
    .delete(workingHours)
    .where(and(eq(workingHours.businessId, businessId), staffId ? eq(workingHours.staffId, staffId) : isNull(workingHours.staffId)));
  if (rules.length) {
    await tx.insert(workingHours).values(
      rules.map((r) => ({ businessId, staffId, weekday: r.weekday, startTime: r.start, endTime: r.end === "24:00" ? "24:00:00" : r.end })),
    );
  }
}

export async function setBreaks(tx: Tx, businessId: string, staffId: string | null, rules: (WeeklyRule & { label?: string })[]): Promise<void> {
  validateRules(rules);
  await tx.delete(breaks).where(and(eq(breaks.businessId, businessId), staffId ? eq(breaks.staffId, staffId) : isNull(breaks.staffId)));
  if (rules.length) {
    await tx.insert(breaks).values(
      rules.map((r) => ({ businessId, staffId, weekday: r.weekday, startTime: r.start, endTime: r.end, label: r.label ?? null })),
    );
  }
}

const toRule = (r: { weekday: number; startTime: string; endTime: string }): WeeklyRule => ({
  weekday: r.weekday,
  start: r.startTime.slice(0, 5),
  end: r.endTime.startsWith("24") ? "24:00" : r.endTime.slice(0, 5),
});

export async function getWeeklyHours(tx: Tx, businessId: string, staffId: string | null): Promise<WeeklyRule[]> {
  const rows = await tx
    .select()
    .from(workingHours)
    .where(and(eq(workingHours.businessId, businessId), staffId ? eq(workingHours.staffId, staffId) : isNull(workingHours.staffId)))
    .orderBy(asc(workingHours.weekday), asc(workingHours.startTime));
  return rows.map(toRule);
}

export async function getBreaks(tx: Tx, businessId: string, staffId: string | null): Promise<WeeklyRule[]> {
  const rows = await tx
    .select()
    .from(breaks)
    .where(and(eq(breaks.businessId, businessId), staffId ? eq(breaks.staffId, staffId) : isNull(breaks.staffId)))
    .orderBy(asc(breaks.weekday), asc(breaks.startTime));
  return rows.map(toRule);
}

export async function addHoliday(
  tx: Tx,
  businessId: string,
  input: { startDate: string; endDate?: string; name?: string | null; staffId?: string | null },
) {
  const endDate = input.endDate || input.startDate;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.startDate) || !/^\d{4}-\d{2}-\d{2}$/.test(endDate) || endDate < input.startDate) {
    throw new DomainError("VALIDATION", "Invalid dates");
  }
  const [row] = await tx
    .insert(holidays)
    .values({ businessId, startDate: input.startDate, endDate, name: input.name ?? null, staffId: input.staffId ?? null })
    .returning();
  return row!;
}

export async function addTimeOff(
  tx: Tx,
  businessId: string,
  input: { staffId: string; startsAt: Date; endsAt: Date; reason?: string | null },
) {
  if (!(input.endsAt > input.startsAt)) throw new DomainError("VALIDATION", "End must be after start");
  const [row] = await tx
    .insert(timeOff)
    .values({ businessId, staffId: input.staffId, startsAt: input.startsAt, endsAt: input.endsAt, reason: input.reason ?? null })
    .returning();
  return row!;
}

// ---------------------------------------------------------------------------
// Services
// ---------------------------------------------------------------------------

export type ServiceInput = {
  name: LocalizedText;
  description?: LocalizedText;
  category?: string | null;
  durationMinutes: number;
  bufferBeforeMinutes?: number;
  bufferAfterMinutes?: number;
  priceCents?: number | null;
  priceFrom?: boolean;
  depositRequired?: boolean;
  depositCents?: number;
  recallIntervalDays?: number | null;
  bookableOnline?: boolean;
  active?: boolean;
  staffIds?: string[];
};

function validateService(input: Partial<ServiceInput>) {
  if (input.name && !Object.values(input.name).some((v) => v && v.trim())) {
    throw new DomainError("VALIDATION", "Service name is required", { field: "name" });
  }
  if (input.durationMinutes !== undefined && (input.durationMinutes < 5 || input.durationMinutes > 600)) {
    throw new DomainError("VALIDATION", "Duration must be between 5 and 600 minutes", { field: "durationMinutes" });
  }
}

export async function listServices(tx: Tx, businessId: string, opts: { activeOnly?: boolean; onlineOnly?: boolean } = {}) {
  return tx
    .select()
    .from(services)
    .where(
      and(
        eq(services.businessId, businessId),
        opts.activeOnly ? eq(services.active, true) : undefined,
        opts.onlineOnly ? eq(services.bookableOnline, true) : undefined,
      ),
    )
    .orderBy(asc(services.sortOrder), asc(services.createdAt));
}

export async function createService(tx: Tx, businessId: string, input: ServiceInput, actor?: Actor): Promise<Service> {
  validateService(input);
  const [{ max } = { max: 0 }] = await tx
    .select({ max: sql<number>`coalesce(max(${services.sortOrder}), 0)::int` })
    .from(services)
    .where(eq(services.businessId, businessId));
  const [svc] = await tx
    .insert(services)
    .values({
      businessId,
      name: input.name,
      description: input.description ?? {},
      category: input.category ?? null,
      durationMinutes: input.durationMinutes,
      bufferBeforeMinutes: input.bufferBeforeMinutes ?? 0,
      bufferAfterMinutes: input.bufferAfterMinutes ?? 0,
      priceCents: input.priceCents ?? null,
      priceFrom: input.priceFrom ?? false,
      depositRequired: input.depositRequired ?? false,
      depositCents: input.depositCents ?? 0,
      recallIntervalDays: input.recallIntervalDays ?? null,
      bookableOnline: input.bookableOnline ?? true,
      active: input.active ?? true,
      sortOrder: max + 1,
    })
    .returning();
  if (input.staffIds) await setServiceStaff(tx, businessId, svc!.id, input.staffIds);
  if (actor) await audit(tx, { businessId, actor, action: "service.created", entityType: "service", entityId: svc!.id });
  return svc!;
}

export async function updateService(tx: Tx, businessId: string, id: string, input: Partial<ServiceInput>, actor?: Actor) {
  validateService(input);
  const { staffIds, ...fields } = input;
  const [svc] = await tx
    .update(services)
    .set(fields)
    .where(and(eq(services.id, id), eq(services.businessId, businessId)))
    .returning();
  if (!svc) throw new DomainError("NOT_FOUND", "Service not found");
  if (staffIds) await setServiceStaff(tx, businessId, id, staffIds);
  if (actor) await audit(tx, { businessId, actor, action: "service.updated", entityType: "service", entityId: id, changes: fields });
  return svc;
}

export async function setServiceStaff(tx: Tx, businessId: string, serviceId: string, staffIds: string[]) {
  await tx.delete(staffServices).where(and(eq(staffServices.businessId, businessId), eq(staffServices.serviceId, serviceId)));
  if (staffIds.length) {
    await tx
      .insert(staffServices)
      .values([...new Set(staffIds)].map((staffId) => ({ businessId, staffId, serviceId })))
      .onConflictDoNothing();
  }
}

export async function setStaffServices(tx: Tx, businessId: string, staffId: string, serviceIds: string[]) {
  await tx.delete(staffServices).where(and(eq(staffServices.businessId, businessId), eq(staffServices.staffId, staffId)));
  if (serviceIds.length) {
    await tx
      .insert(staffServices)
      .values([...new Set(serviceIds)].map((serviceId) => ({ businessId, staffId, serviceId })))
      .onConflictDoNothing();
  }
}

export async function getStaffServiceLinks(tx: Tx, businessId: string) {
  return tx
    .select({ staffId: staffServices.staffId, serviceId: staffServices.serviceId })
    .from(staffServices)
    .where(eq(staffServices.businessId, businessId));
}

// ---------------------------------------------------------------------------
// Staff
// ---------------------------------------------------------------------------

export type StaffInput = {
  name: string;
  title?: LocalizedText;
  color?: string;
  email?: string | null;
  phone?: string | null;
  active?: boolean;
  bookableOnline?: boolean;
  serviceIds?: string[];
  hours?: WeeklyRule[];
};

export async function listStaff(tx: Tx, businessId: string, opts: { activeOnly?: boolean } = {}): Promise<Staff[]> {
  return tx
    .select()
    .from(staff)
    .where(and(eq(staff.businessId, businessId), opts.activeOnly ? eq(staff.active, true) : undefined))
    .orderBy(asc(staff.sortOrder), asc(staff.createdAt));
}

export async function createStaff(tx: Tx, businessId: string, input: StaffInput, actor?: Actor): Promise<Staff> {
  if (!input.name?.trim()) throw new DomainError("VALIDATION", "Name is required", { field: "name" });
  const existing = await listStaff(tx, businessId);
  const [row] = await tx
    .insert(staff)
    .values({
      businessId,
      name: input.name.trim(),
      title: input.title ?? {},
      color: input.color ?? STAFF_COLORS[existing.length % STAFF_COLORS.length]!,
      email: input.email ?? null,
      phone: input.phone ?? null,
      active: input.active ?? true,
      bookableOnline: input.bookableOnline ?? true,
      sortOrder: existing.length,
    })
    .returning();
  if (input.serviceIds) await setStaffServices(tx, businessId, row!.id, input.serviceIds);
  if (input.hours) await setWeeklyHours(tx, businessId, row!.id, input.hours);
  if (actor) await audit(tx, { businessId, actor, action: "staff.created", entityType: "staff", entityId: row!.id });
  return row!;
}

export async function updateStaff(tx: Tx, businessId: string, id: string, input: Partial<StaffInput>, actor?: Actor) {
  const { serviceIds, hours, ...fields } = input;
  const [row] = await tx
    .update(staff)
    .set(fields)
    .where(and(eq(staff.id, id), eq(staff.businessId, businessId)))
    .returning();
  if (!row) throw new DomainError("NOT_FOUND", "Staff not found");
  if (serviceIds) await setStaffServices(tx, businessId, id, serviceIds);
  if (hours) await setWeeklyHours(tx, businessId, id, hours);
  if (actor) await audit(tx, { businessId, actor, action: "staff.updated", entityType: "staff", entityId: id, changes: fields });
  return row;
}

export async function completeOnboarding(tx: Tx, businessId: string): Promise<void> {
  await tx.update(businesses).set({ onboardingCompletedAt: new Date() }).where(eq(businesses.id, businessId));
}

/** Services visible on the public booking page (active + online + at least one bookable staff). */
export async function publicServices(tx: Tx, businessId: string) {
  const svc = await listServices(tx, businessId, { activeOnly: true, onlineOnly: true });
  if (!svc.length) return [];
  const links = await tx
    .select({ serviceId: staffServices.serviceId })
    .from(staffServices)
    .innerJoin(staff, eq(staff.id, staffServices.staffId))
    .where(
      and(
        eq(staffServices.businessId, businessId),
        inArray(staffServices.serviceId, svc.map((s) => s.id)),
        eq(staff.active, true),
        eq(staff.bookableOnline, true),
      ),
    );
  const ok = new Set(links.map((l) => l.serviceId));
  return svc.filter((s) => ok.has(s.id));
}
