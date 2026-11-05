"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import {
  cancelBooking,
  createBooking,
  getAvailableSlots,
  rescheduleBooking,
  setAppointmentStatus,
} from "@fekerte/core/booking/service";
import {
  addHoliday,
  addTimeOff,
  createService,
  createStaff,
  setBreaks,
  setWeeklyHours,
  updateService,
  updateStaff,
  isValidSlug,
  slugify,
} from "@fekerte/core/business/setup";
import { businesses, customers, holidays, timeOff, type Locale } from "@fekerte/core/db/schema";
import { withSystem } from "@fekerte/core/db/tenant";
import { audit } from "@fekerte/core/lib/audit";
import { DomainError } from "@fekerte/core/lib/errors";
import { normalizePhone } from "@fekerte/core/lib/phone";
import { tenantAction, runAction, type ActionResult } from "@/lib/actions";
import { BUSINESS_COOKIE, requireUser } from "@/lib/auth/current";
import { getUserMemberships } from "@fekerte/core/auth/users";

const refresh = () => revalidatePath("/dashboard", "layout");

const uuid = z.string().uuid();
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const clock = z.string().regex(/^([01]\d|2[0-4]):[0-5]\d$/);
const ruleSchema = z.object({ weekday: z.number().int().min(1).max(7), start: clock, end: clock });
const localized = z.object({ ar: z.string().max(120).optional(), en: z.string().max(120).optional(), fr: z.string().max(120).optional() });

// ---------------------------------------------------------------------------
// Appointments
// ---------------------------------------------------------------------------

export async function getSlotsAction(input: { serviceId: string; staffId?: string | null; date: string }) {
  return tenantAction(async (tx, ctx) => {
    const p = z.object({ serviceId: uuid, staffId: uuid.nullish(), date: isoDate }).parse(input);
    return getAvailableSlots(tx, ctx.business.id, {
      serviceId: p.serviceId,
      staffId: p.staffId ?? null,
      fromDate: p.date,
      toDate: p.date,
      channel: "internal",
    });
  });
}

const createSchema = z.object({
  serviceId: uuid,
  staffId: uuid.nullish(),
  startsAt: z.string().datetime(),
  phone: z.string().min(3).max(30),
  name: z.string().max(120).optional(),
  notes: z.string().max(1000).optional(),
  internalNotes: z.string().max(2000).optional(),
  override: z.boolean().optional(),
  notifyCustomer: z.boolean().optional(),
  language: z.enum(["ar", "en", "fr"]).optional(),
});

export async function createAppointmentAction(input: z.infer<typeof createSchema>): Promise<ActionResult<{ id: string }>> {
  const res = await tenantAction(async (tx, ctx) => {
    const p = createSchema.parse(input);
    const appt = await createBooking(tx, ctx.business.id, {
      serviceId: p.serviceId,
      staffId: p.staffId ?? null,
      startsAt: p.startsAt,
      customer: { phone: p.phone, name: p.name, language: p.language as Locale | undefined },
      notes: p.notes,
      internalNotes: p.internalNotes,
      source: "dashboard",
      actor: ctx.actor,
      override: p.override,
      notifyCustomer: p.notifyCustomer ?? true,
    });
    return { id: appt.id };
  });
  if (res.ok) refresh();
  return res;
}

export async function moveAppointmentAction(input: { id: string; startsAt: string; staffId?: string | null; override?: boolean }) {
  const res = await tenantAction(async (tx, ctx) => {
    const p = z.object({ id: uuid, startsAt: z.string().datetime(), staffId: uuid.nullish(), override: z.boolean().optional() }).parse(input);
    const appt = await rescheduleBooking(tx, ctx.business.id, p.id, {
      startsAt: p.startsAt,
      staffId: p.staffId ?? null,
      actor: ctx.actor,
      override: p.override ?? true,
    });
    return { id: appt.id };
  });
  if (res.ok) refresh();
  return res;
}

export async function setStatusAction(input: { id: string; status: "confirmed" | "completed" | "no_show" }) {
  const res = await tenantAction(async (tx, ctx) => {
    const p = z.object({ id: uuid, status: z.enum(["confirmed", "completed", "no_show"]) }).parse(input);
    await setAppointmentStatus(tx, ctx.business.id, p.id, p.status, ctx.actor);
    return null;
  });
  if (res.ok) refresh();
  return res;
}

export async function cancelAppointmentAction(input: { id: string; reason?: string; notifyCustomer?: boolean }) {
  const res = await tenantAction(async (tx, ctx) => {
    const p = z.object({ id: uuid, reason: z.string().max(500).optional(), notifyCustomer: z.boolean().optional() }).parse(input);
    await cancelBooking(tx, ctx.business.id, p.id, { actor: ctx.actor, reason: p.reason, notifyCustomer: p.notifyCustomer ?? true });
    return null;
  });
  if (res.ok) refresh();
  return res;
}

// ---------------------------------------------------------------------------
// Customers
// ---------------------------------------------------------------------------

export async function updateCustomerAction(input: {
  id: string;
  name?: string;
  notes?: string;
  tags?: string[];
  preferredLanguage?: Locale | null;
  consentWhatsapp?: boolean;
  consentMarketing?: boolean;
}) {
  const res = await tenantAction(async (tx, ctx) => {
    const p = z
      .object({
        id: uuid,
        name: z.string().max(120).optional(),
        notes: z.string().max(5000).optional(),
        tags: z.array(z.string().trim().min(1).max(40)).max(30).optional(),
        preferredLanguage: z.enum(["ar", "en", "fr"]).nullish(),
        consentWhatsapp: z.boolean().optional(),
        consentMarketing: z.boolean().optional(),
      })
      .parse(input);
    const { id, ...fields } = p;
    const set: Partial<typeof customers.$inferInsert> = { ...fields };
    if (fields.tags) set.tags = [...new Set(fields.tags.map((t) => t.toLowerCase()))];
    if (fields.consentWhatsapp === false) set.optedOutAt = new Date();
    if (fields.consentWhatsapp === true) set.optedOutAt = null;
    const [row] = await tx
      .update(customers)
      .set(set)
      .where(and(eq(customers.id, id), eq(customers.businessId, ctx.business.id)))
      .returning({ id: customers.id });
    if (!row) throw new DomainError("NOT_FOUND", "Customer not found");
    await audit(tx, { businessId: ctx.business.id, actor: ctx.actor, action: "customer.updated", entityType: "customer", entityId: id, changes: fields });
    return null;
  });
  if (res.ok) refresh();
  return res;
}

// ---------------------------------------------------------------------------
// Services & staff
// ---------------------------------------------------------------------------

const serviceSchema = z.object({
  name: localized,
  description: localized.optional(),
  category: z.string().max(60).nullish(),
  durationMinutes: z.number().int().min(5).max(600),
  bufferBeforeMinutes: z.number().int().min(0).max(240).optional(),
  bufferAfterMinutes: z.number().int().min(0).max(240).optional(),
  priceCents: z.number().int().min(0).max(10_000_000).nullish(),
  priceFrom: z.boolean().optional(),
  depositRequired: z.boolean().optional(),
  depositCents: z.number().int().min(0).max(10_000_000).optional(),
  recallIntervalDays: z.number().int().min(1).max(3650).nullish(),
  bookableOnline: z.boolean().optional(),
  active: z.boolean().optional(),
  staffIds: z.array(uuid).optional(),
});

export async function saveServiceAction(input: { id?: string | null; data: z.infer<typeof serviceSchema> }) {
  const res = await tenantAction(
    async (tx, ctx) => {
      const data = serviceSchema.parse(input.data);
      if (input.id) await updateService(tx, ctx.business.id, uuid.parse(input.id), data, ctx.actor);
      else await createService(tx, ctx.business.id, data, ctx.actor);
      return null;
    },
    { ownerOnly: true },
  );
  if (res.ok) refresh();
  return res;
}

const staffSchema = z.object({
  name: z.string().trim().min(1).max(80),
  title: localized.optional(),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  phone: z.string().max(30).nullish(),
  email: z.string().email().nullish().or(z.literal("")),
  active: z.boolean().optional(),
  bookableOnline: z.boolean().optional(),
  serviceIds: z.array(uuid).optional(),
  /** null = follow business hours. */
  hours: z.array(ruleSchema).nullable().optional(),
});

export async function saveStaffAction(input: { id?: string | null; data: z.infer<typeof staffSchema> }) {
  const res = await tenantAction(
    async (tx, ctx) => {
      const { hours, email, phone, ...data } = staffSchema.parse(input.data);
      const normalized = {
        ...data,
        email: email || null,
        phone: phone ? (normalizePhone(phone) ?? phone) : null,
        hours: hours === null ? [] : hours,
      };
      if (input.id) await updateStaff(tx, ctx.business.id, uuid.parse(input.id), normalized, ctx.actor);
      else await createStaff(tx, ctx.business.id, normalized, ctx.actor);
      return null;
    },
    { ownerOnly: true },
  );
  if (res.ok) refresh();
  return res;
}

export async function addTimeOffAction(input: { staffId: string; startsAt: string; endsAt: string; reason?: string }) {
  const res = await tenantAction(async (tx, ctx) => {
    const p = z.object({ staffId: uuid, startsAt: z.string().datetime(), endsAt: z.string().datetime(), reason: z.string().max(200).optional() }).parse(input);
    await addTimeOff(tx, ctx.business.id, { staffId: p.staffId, startsAt: new Date(p.startsAt), endsAt: new Date(p.endsAt), reason: p.reason });
    return null;
  });
  if (res.ok) refresh();
  return res;
}

export async function deleteTimeOffAction(id: string) {
  const res = await tenantAction(async (tx, ctx) => {
    await tx.delete(timeOff).where(and(eq(timeOff.id, uuid.parse(id)), eq(timeOff.businessId, ctx.business.id)));
    return null;
  });
  if (res.ok) refresh();
  return res;
}

// ---------------------------------------------------------------------------
// Hours & holidays
// ---------------------------------------------------------------------------

export async function saveBusinessHoursAction(input: { hours: z.infer<typeof ruleSchema>[]; breaks: z.infer<typeof ruleSchema>[] }) {
  const res = await tenantAction(
    async (tx, ctx) => {
      const p = z.object({ hours: z.array(ruleSchema), breaks: z.array(ruleSchema) }).parse(input);
      await setWeeklyHours(tx, ctx.business.id, null, p.hours);
      await setBreaks(tx, ctx.business.id, null, p.breaks);
      await audit(tx, { businessId: ctx.business.id, actor: ctx.actor, action: "hours.updated", entityType: "business", entityId: ctx.business.id });
      return null;
    },
    { ownerOnly: true },
  );
  if (res.ok) refresh();
  return res;
}

export async function addHolidayAction(input: { startDate: string; endDate?: string; name?: string; staffId?: string | null }) {
  const res = await tenantAction(
    async (tx, ctx) => {
      const p = z.object({ startDate: isoDate, endDate: isoDate.optional().or(z.literal("")), name: z.string().max(100).optional(), staffId: uuid.nullish() }).parse(input);
      await addHoliday(tx, ctx.business.id, { startDate: p.startDate, endDate: p.endDate || undefined, name: p.name, staffId: p.staffId });
      return null;
    },
    { ownerOnly: true },
  );
  if (res.ok) refresh();
  return res;
}

export async function deleteHolidayAction(id: string) {
  const res = await tenantAction(
    async (tx, ctx) => {
      await tx.delete(holidays).where(and(eq(holidays.id, uuid.parse(id)), eq(holidays.businessId, ctx.business.id)));
      return null;
    },
    { ownerOnly: true },
  );
  if (res.ok) refresh();
  return res;
}

// ---------------------------------------------------------------------------
// Business settings
// ---------------------------------------------------------------------------

const settingsSchema = z.object({
  name: z.string().trim().min(2).max(120),
  slug: z.string().trim().min(3).max(48),
  vertical: z.string().max(30),
  phone: z.string().max(30).nullish(),
  email: z.string().email().nullish().or(z.literal("")),
  address: z.string().max(300).nullish(),
  city: z.string().max(80).nullish(),
  mapsUrl: z.string().url().nullish().or(z.literal("")),
  googleReviewUrl: z.string().url().nullish().or(z.literal("")),
  whatsappNumber: z.string().max(30).nullish(),
  languages: z.array(z.enum(["ar", "en", "fr"])).min(1),
  defaultLanguage: z.enum(["ar", "en", "fr"]),
  timezone: z.string().max(60),
  showLbp: z.boolean(),
  lbpRate: z.number().int().min(1).max(10_000_000),
  branding: z.object({
    primaryColor: z.string().regex(/^#[0-9a-fA-F]{6}$/).nullish(),
    logoUrl: z.string().url().nullish().or(z.literal("")),
    tagline: localized.optional(),
  }),
  bookingSettings: z.object({
    minNoticeMinutes: z.number().int().min(0).max(60 * 24 * 14),
    maxDaysAhead: z.number().int().min(1).max(365),
    slotGranularityMinutes: z.number().int().refine((v) => [5, 10, 15, 20, 30, 60].includes(v)),
    allowAnyStaff: z.boolean(),
    requireApproval: z.boolean(),
    cancellationNoticeHours: z.number().int().min(0).max(24 * 14),
    reminderOffsetsMinutes: z.array(z.number().int().min(15).max(60 * 24 * 7)).max(4),
    askConfirmation: z.boolean(),
    depositHoldHours: z.number().int().min(1).max(168),
    depositAfterNoShows: z.number().int().min(0).max(20),
    policies: localized.optional(),
  }),
});

export async function saveSettingsAction(input: z.infer<typeof settingsSchema>) {
  const res = await tenantAction(
    async (tx, ctx) => {
      const p = settingsSchema.parse(input);
      const slug = slugify(p.slug);
      if (!isValidSlug(slug)) throw new DomainError("VALIDATION", "Invalid booking link", { field: "slug" });
      if (slug !== ctx.business.slug) {
        const taken = await withSystem((sys) => sys.select({ id: businesses.id }).from(businesses).where(eq(businesses.slug, slug)));
        if (taken.length) throw new DomainError("CONFLICT", "This booking link is already taken", { field: "slug" });
      }
      if (!p.languages.includes(p.defaultLanguage)) p.languages.unshift(p.defaultLanguage);
      await tx
        .update(businesses)
        .set({
          name: p.name,
          slug,
          vertical: p.vertical,
          phone: p.phone ? (normalizePhone(p.phone) ?? p.phone) : null,
          email: p.email || null,
          address: p.address || null,
          city: p.city || null,
          mapsUrl: p.mapsUrl || null,
          googleReviewUrl: p.googleReviewUrl || null,
          whatsappNumber: p.whatsappNumber ? (normalizePhone(p.whatsappNumber) ?? p.whatsappNumber) : null,
          languages: p.languages,
          defaultLanguage: p.defaultLanguage,
          timezone: p.timezone,
          showLbp: p.showLbp,
          lbpRate: p.lbpRate,
          branding: { ...ctx.business.branding, ...p.branding, logoUrl: p.branding.logoUrl || null },
          bookingSettings: { ...ctx.business.bookingSettings, ...p.bookingSettings },
        })
        .where(eq(businesses.id, ctx.business.id));
      await audit(tx, { businessId: ctx.business.id, actor: ctx.actor, action: "settings.updated", entityType: "business", entityId: ctx.business.id });
      return null;
    },
    { ownerOnly: true },
  );
  if (res.ok) refresh();
  return res;
}

export async function switchBusinessAction(businessId: string) {
  return runAction(async () => {
    const user = await requireUser();
    const memberships = await withSystem((tx) => getUserMemberships(tx, user.id));
    if (!memberships.some((m) => m.businessId === businessId)) throw new DomainError("FORBIDDEN", "Not a member");
    (await cookies()).set(BUSINESS_COOKIE, businessId, { path: "/", httpOnly: true, sameSite: "lax", maxAge: 31536000 });
    refresh();
    return null;
  });
}
