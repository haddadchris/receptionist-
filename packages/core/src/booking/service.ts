/**
 * Booking service: the only code path that creates/moves/cancels appointments.
 * Used by the dashboard, the public booking page, and the AI agent tools, so all
 * channels share the same rules.
 *
 * Concurrency: inside the caller's tenant transaction we take a per-staff
 * advisory lock, re-load the calendar and re-check the slot. The Postgres
 * exclusion constraint `appointments_no_overlap` is the final guard.
 */
import { and, asc, desc, eq, gte, ilike, inArray, lt, ne, or, sql, type SQL } from "drizzle-orm";
import { DateTime } from "luxon";
import type { Tx } from "../db/tenant";
import {
  appointments,
  customers,
  services,
  staff,
  type Appointment,
  type AppointmentSource,
  type AppointmentStatus,
  type Business,
  type Customer,
  type Locale,
} from "../db/schema";
import { checkSlot, computeSlots, type Slot, type SlotRejection } from "../availability/engine";
import { bookingSettings, loadAvailability, type Channel } from "../availability/loader";
import { audit, type Actor } from "../lib/audit";
import { DomainError, isExclusionViolation } from "../lib/errors";
import { normalizePhone } from "../lib/phone";
import { cancelAppointmentJobs, enqueueJob } from "../jobs/queue";

export const NOTIFY_JOB = "notify.appointment";

export type NotificationKind = "confirmation" | "pending" | "reminder" | "rescheduled" | "cancelled";

/** Local-date window that surely contains `d` in any timezone (UTC date ±1). */
function around(d: Date): { fromDate: string; toDate: string } {
  const utc = DateTime.fromJSDate(d, { zone: "utc" });
  return { fromDate: utc.minus({ days: 1 }).toISODate()!, toDate: utc.plus({ days: 1 }).toISODate()! };
}

const channelFor = (source: AppointmentSource): Channel => (source === "dashboard" ? "internal" : "public");

/** Reasons a dashboard override may ignore (but never conflicts). */
const OVERRIDABLE: SlotRejection[] = ["outside_hours", "break", "time_off", "holiday", "too_soon", "too_far"];

const REJECTION_PRIORITY: SlotRejection[] = [
  "conflict",
  "resource_full",
  "break",
  "time_off",
  "holiday",
  "outside_hours",
  "too_soon",
  "too_far",
  "unknown_staff",
];

// ---------------------------------------------------------------------------
// Slots
// ---------------------------------------------------------------------------

export async function getAvailableSlots(
  tx: Tx,
  businessId: string,
  opts: { serviceId: string; staffId?: string | null; fromDate: string; toDate: string; channel?: Channel; now?: Date },
): Promise<Slot[]> {
  const { input } = await loadAvailability(tx, businessId, {
    serviceId: opts.serviceId,
    staffId: opts.staffId,
    fromDate: opts.fromDate,
    toDate: opts.toDate,
    channel: opts.channel ?? "public",
    now: opts.now,
  });
  return computeSlots(input, { fromDate: opts.fromDate, toDate: opts.toDate, staffId: opts.staffId });
}

// ---------------------------------------------------------------------------
// Customers
// ---------------------------------------------------------------------------

export async function upsertCustomer(
  tx: Tx,
  businessId: string,
  input: { phone: string; name?: string | null; language?: Locale | null; source?: AppointmentSource; consentMarketing?: boolean },
): Promise<Customer> {
  const phone = normalizePhone(input.phone);
  if (!phone) throw new DomainError("VALIDATION", "Invalid phone number", { field: "phone" });
  const name = input.name?.trim() || null;
  const [row] = await tx
    .insert(customers)
    .values({
      businessId,
      phone,
      name,
      preferredLanguage: input.language ?? null,
      source: input.source ?? null,
      consentMarketing: input.consentMarketing ?? false,
      consentedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: [customers.businessId, customers.phone],
      set: {
        name: sql`coalesce(${customers.name}, excluded.name)`,
        preferredLanguage: sql`coalesce(excluded.preferred_language, ${customers.preferredLanguage})`,
        consentMarketing: input.consentMarketing ? sql`true` : sql`${customers.consentMarketing}`,
        updatedAt: new Date(),
      },
    })
    .returning();
  return row!;
}

export async function findCustomerByPhone(tx: Tx, businessId: string, phoneInput: string): Promise<Customer | null> {
  const phone = normalizePhone(phoneInput);
  if (!phone) return null;
  const [row] = await tx
    .select()
    .from(customers)
    .where(and(eq(customers.businessId, businessId), eq(customers.phone, phone)));
  return row ?? null;
}

// ---------------------------------------------------------------------------
// Create
// ---------------------------------------------------------------------------

export type CreateBookingInput = {
  serviceId: string;
  /** null/undefined = any available staff. */
  staffId?: string | null;
  startsAt: string | Date;
  customer: { phone: string; name?: string | null; language?: Locale | null; consentMarketing?: boolean };
  notes?: string | null;
  internalNotes?: string | null;
  source: AppointmentSource;
  actor: Actor;
  /** Dashboard only: allow outside hours/notice (never allows overlaps). */
  override?: boolean;
  status?: AppointmentStatus;
  conversationId?: string | null;
  notifyCustomer?: boolean;
  now?: Date;
};

async function lockKeys(tx: Tx, keys: string[]) {
  for (const key of [...keys].sort()) {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${key}, 0))`);
  }
}

function pickReason(reasons: SlotRejection[]): SlotRejection {
  return REJECTION_PRIORITY.find((r) => reasons.includes(r)) ?? "conflict";
}

export async function createBooking(tx: Tx, businessId: string, input: CreateBookingInput): Promise<Appointment> {
  const channel = channelFor(input.source);
  const override = channel === "internal" && !!input.override;
  const startsAt = new Date(input.startsAt);
  if (Number.isNaN(startsAt.getTime())) throw new DomainError("VALIDATION", "Invalid start time");

  const first = await loadAvailability(tx, businessId, {
    serviceId: input.serviceId,
    staffId: input.staffId,
    ...around(startsAt),
    channel,
    now: input.now,
  });
  const { business, service } = first;
  if (first.staff.length === 0) throw new DomainError("VALIDATION", "No staff can perform this service");

  // Candidate staff in preference order: least booked that day first.
  const date = DateTime.fromJSDate(startsAt).setZone(business.timezone).toISODate()!;
  const daySlots = computeSlots(first.input, { fromDate: date, toDate: date, staffId: input.staffId });
  const slotStaff = daySlots.find((s) => Date.parse(s.start) === startsAt.getTime())?.staffIds ?? [];
  const candidates = input.staffId ? [input.staffId] : [...slotStaff, ...first.staff.map((s) => s.id).filter((id) => !slotStaff.includes(id))];

  const customer = await upsertCustomer(tx, businessId, {
    ...input.customer,
    source: input.source,
  });

  const reasons: SlotRejection[] = [];
  for (const staffId of candidates) {
    await lockKeys(tx, [`staff:${staffId}`, ...(service.resourceId ? [`resource:${service.resourceId}`] : [])]);
    // Re-load after acquiring the lock so we see any booking committed meanwhile.
    const fresh = await loadAvailability(tx, businessId, {
      serviceId: input.serviceId,
      staffId,
      fromDate: date,
      toDate: date,
      channel,
      now: input.now,
    });
    const check = checkSlot(fresh.input, staffId, startsAt);
    if (!check.ok && !(override && OVERRIDABLE.includes(check.reason))) {
      reasons.push(check.reason);
      continue;
    }
    const settings = bookingSettings(business);
    const status: AppointmentStatus =
      input.status ?? (channel === "public" && settings.requireApproval ? "pending" : "confirmed");
    const endsAt = new Date(startsAt.getTime() + service.durationMinutes * 60_000);
    let appt: Appointment | undefined;
    try {
      appt = await tx.transaction(async (sp) => {
        const [row] = await sp
          .insert(appointments)
          .values({
            businessId,
            customerId: customer.id,
            staffId,
            serviceId: service.id,
            resourceId: service.resourceId,
            startsAt,
            endsAt,
            bufferBeforeMinutes: service.bufferBeforeMinutes,
            bufferAfterMinutes: service.bufferAfterMinutes,
            blockedStart: new Date(startsAt.getTime() - service.bufferBeforeMinutes * 60_000),
            blockedEnd: new Date(endsAt.getTime() + service.bufferAfterMinutes * 60_000),
            status,
            source: input.source,
            notes: input.notes ?? null,
            internalNotes: input.internalNotes ?? null,
            priceCents: service.priceCents,
            createdByUserId: input.actor.type === "user" ? input.actor.userId : null,
            conversationId: input.conversationId ?? null,
          })
          .returning();
        return row!;
      });
    } catch (e) {
      if (isExclusionViolation(e)) {
        reasons.push("conflict");
        continue;
      }
      throw e;
    }
    await audit(tx, {
      businessId,
      actor: input.actor,
      action: "appointment.created",
      entityType: "appointment",
      entityId: appt.id,
      changes: { startsAt: appt.startsAt, staffId, serviceId: service.id, source: input.source, status, override },
    });
    if (input.notifyCustomer !== false && appt.endsAt > new Date()) {
      await enqueueNotification(tx, appt, status === "pending" ? "pending" : "confirmation");
      await scheduleReminders(tx, appt, business);
    }
    return appt;
  }
  const reason = pickReason(reasons);
  throw new DomainError("SLOT_UNAVAILABLE", `Slot not available (${reason})`, { reason });
}

// ---------------------------------------------------------------------------
// Notifications scheduling
// ---------------------------------------------------------------------------

export async function enqueueNotification(
  tx: Tx,
  appt: Pick<Appointment, "id" | "businessId" | "startsAt">,
  kind: NotificationKind,
  extra: Record<string, unknown> = {},
): Promise<void> {
  await enqueueJob(tx, {
    type: NOTIFY_JOB,
    businessId: appt.businessId,
    payload: { appointmentId: appt.id, kind, expectedStartsAt: appt.startsAt.toISOString(), ...extra },
    dedupeKey: `${kind}:${appt.id}:${appt.startsAt.toISOString()}:${kind === "cancelled" ? "x" : Date.now()}`,
  });
}

export async function scheduleReminders(
  tx: Tx,
  appt: Pick<Appointment, "id" | "businessId" | "startsAt">,
  business: Business,
  now = new Date(),
): Promise<number> {
  const settings = bookingSettings(business);
  const offsets = [...new Set(settings.reminderOffsetsMinutes)].sort((a, b) => b - a);
  let count = 0;
  for (const [i, offset] of offsets.entries()) {
    const runAt = new Date(appt.startsAt.getTime() - offset * 60_000);
    if (runAt.getTime() <= now.getTime() + 60_000) continue;
    await enqueueJob(tx, {
      type: NOTIFY_JOB,
      businessId: appt.businessId,
      runAt,
      payload: {
        appointmentId: appt.id,
        kind: "reminder",
        offsetMinutes: offset,
        expectedStartsAt: appt.startsAt.toISOString(),
        askConfirmation: settings.askConfirmation && i === 0,
      },
      dedupeKey: `reminder:${appt.id}:${offset}:${appt.startsAt.toISOString()}`,
    });
    count++;
  }
  return count;
}

// ---------------------------------------------------------------------------
// Reschedule / cancel / status
// ---------------------------------------------------------------------------

async function getAppointmentRow(tx: Tx, businessId: string, id: string): Promise<Appointment> {
  const [row] = await tx
    .select()
    .from(appointments)
    .where(and(eq(appointments.id, id), eq(appointments.businessId, businessId)));
  if (!row) throw new DomainError("NOT_FOUND", "Appointment not found");
  return row;
}

function assertCustomerNotice(appt: Appointment, business: Business, actor: Actor, now = new Date()) {
  if (actor.type !== "customer") return;
  const hours = bookingSettings(business).cancellationNoticeHours;
  if (appt.startsAt.getTime() - now.getTime() < hours * 3_600_000) {
    throw new DomainError("TOO_LATE", `Changes must be made at least ${hours}h before the appointment`, { hours });
  }
}

export async function rescheduleBooking(
  tx: Tx,
  businessId: string,
  appointmentId: string,
  input: { startsAt: string | Date; staffId?: string | null; actor: Actor; override?: boolean; notifyCustomer?: boolean; now?: Date },
): Promise<Appointment> {
  const appt = await getAppointmentRow(tx, businessId, appointmentId);
  if (appt.status !== "pending" && appt.status !== "confirmed") {
    throw new DomainError("CONFLICT", `Cannot reschedule a ${appt.status} appointment`);
  }
  const startsAt = new Date(input.startsAt);
  if (Number.isNaN(startsAt.getTime())) throw new DomainError("VALIDATION", "Invalid start time");
  const isInternal = input.actor.type === "user";
  const channel: Channel = isInternal ? "internal" : "public";
  const override = isInternal && !!input.override;

  const loaded = await loadAvailability(tx, businessId, {
    serviceId: appt.serviceId,
    ...around(startsAt),
    channel,
    excludeAppointmentId: appt.id,
    now: input.now,
  });
  assertCustomerNotice(appt, loaded.business, input.actor, input.now);
  const date = DateTime.fromJSDate(startsAt).setZone(loaded.business.timezone).toISODate()!;
  const candidates = input.staffId
    ? [input.staffId]
    : [appt.staffId, ...loaded.staff.map((s) => s.id).filter((id) => id !== appt.staffId)];

  const reasons: SlotRejection[] = [];
  for (const staffId of candidates) {
    await lockKeys(tx, [`staff:${staffId}`, ...(appt.resourceId ? [`resource:${appt.resourceId}`] : [])]);
    const fresh = await loadAvailability(tx, businessId, {
      serviceId: appt.serviceId,
      staffId,
      fromDate: date,
      toDate: date,
      channel,
      excludeAppointmentId: appt.id,
      now: input.now,
    });
    const check = checkSlot(fresh.input, staffId, startsAt);
    if (!check.ok && !(override && OVERRIDABLE.includes(check.reason))) {
      reasons.push(check.reason);
      continue;
    }
    const duration = appt.endsAt.getTime() - appt.startsAt.getTime();
    const endsAt = new Date(startsAt.getTime() + duration);
    let updated: Appointment;
    try {
      updated = await tx.transaction(async (sp) => {
        const [row] = await sp
          .update(appointments)
          .set({
            startsAt,
            endsAt,
            staffId,
            blockedStart: new Date(startsAt.getTime() - appt.bufferBeforeMinutes * 60_000),
            blockedEnd: new Date(endsAt.getTime() + appt.bufferAfterMinutes * 60_000),
            customerConfirmedAt: null,
          })
          .where(and(eq(appointments.id, appt.id), eq(appointments.businessId, businessId)))
          .returning();
        return row!;
      });
    } catch (e) {
      if (isExclusionViolation(e)) {
        reasons.push("conflict");
        continue;
      }
      throw e;
    }
    await audit(tx, {
      businessId,
      actor: input.actor,
      action: "appointment.rescheduled",
      entityType: "appointment",
      entityId: appt.id,
      changes: { from: { startsAt: appt.startsAt, staffId: appt.staffId }, to: { startsAt, staffId }, override },
    });
    await cancelAppointmentJobs(tx, appt.id, [NOTIFY_JOB]);
    if (input.notifyCustomer !== false && updated.endsAt > new Date()) {
      await enqueueNotification(tx, updated, "rescheduled");
      await scheduleReminders(tx, updated, loaded.business);
    }
    return updated;
  }
  const reason = pickReason(reasons);
  throw new DomainError("SLOT_UNAVAILABLE", `Slot not available (${reason})`, { reason });
}

export async function cancelBooking(
  tx: Tx,
  businessId: string,
  appointmentId: string,
  input: { actor: Actor; reason?: string | null; notifyCustomer?: boolean; now?: Date; business?: Business },
): Promise<Appointment> {
  const appt = await getAppointmentRow(tx, businessId, appointmentId);
  if (appt.status === "cancelled") return appt;
  if (appt.status !== "pending" && appt.status !== "confirmed") {
    throw new DomainError("CONFLICT", `Cannot cancel a ${appt.status} appointment`);
  }
  if (input.actor.type === "customer") {
    const { getBusiness } = await import("../availability/loader");
    assertCustomerNotice(appt, input.business ?? (await getBusiness(tx, businessId)), input.actor, input.now);
  }
  const cancelledBy = input.actor.type === "user" ? "staff" : input.actor.type;
  const [updated] = await tx
    .update(appointments)
    .set({ status: "cancelled", cancelledAt: new Date(), cancelledBy, cancelReason: input.reason ?? null })
    .where(and(eq(appointments.id, appt.id), eq(appointments.businessId, businessId)))
    .returning();
  await audit(tx, {
    businessId,
    actor: input.actor,
    action: "appointment.cancelled",
    entityType: "appointment",
    entityId: appt.id,
    changes: { reason: input.reason ?? null, previousStatus: appt.status },
  });
  await cancelAppointmentJobs(tx, appt.id, [NOTIFY_JOB]);
  if (input.notifyCustomer !== false && appt.startsAt > new Date()) {
    await enqueueNotification(tx, updated!, "cancelled");
  }
  return updated!;
}

export async function setAppointmentStatus(
  tx: Tx,
  businessId: string,
  appointmentId: string,
  status: Exclude<AppointmentStatus, "cancelled">,
  actor: Actor,
): Promise<Appointment> {
  const appt = await getAppointmentRow(tx, businessId, appointmentId);
  if (appt.status === status) return appt;
  if (appt.status === "cancelled") throw new DomainError("CONFLICT", "Appointment is cancelled");
  const [updated] = await tx
    .update(appointments)
    .set({ status })
    .where(and(eq(appointments.id, appt.id), eq(appointments.businessId, businessId)))
    .returning();

  if (status === "no_show") {
    await tx
      .update(customers)
      .set({ noShowCount: sql`${customers.noShowCount} + 1` })
      .where(and(eq(customers.id, appt.customerId), eq(customers.businessId, businessId)));
  } else if (appt.status === "no_show") {
    await tx
      .update(customers)
      .set({ noShowCount: sql`greatest(${customers.noShowCount} - 1, 0)` })
      .where(and(eq(customers.id, appt.customerId), eq(customers.businessId, businessId)));
  }
  if (status === "completed") {
    await tx
      .update(customers)
      .set({ lastVisitAt: sql`greatest(coalesce(${customers.lastVisitAt}, 'epoch'::timestamptz), ${appt.startsAt.toISOString()}::timestamptz)` })
      .where(and(eq(customers.id, appt.customerId), eq(customers.businessId, businessId)));
  }
  if (status === "confirmed" && appt.status === "pending" && appt.startsAt > new Date()) {
    await enqueueNotification(tx, updated!, "confirmation");
  }
  await audit(tx, {
    businessId,
    actor,
    action: `appointment.${status}`,
    entityType: "appointment",
    entityId: appt.id,
    changes: { from: appt.status, to: status },
  });
  return updated!;
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

export type AppointmentView = Appointment & {
  customerName: string | null;
  customerPhone: string;
  serviceName: Record<string, string>;
  serviceDurationMinutes: number;
  staffName: string;
  staffColor: string;
};

const viewColumns = {
  appointment: appointments,
  customerName: customers.name,
  customerPhone: customers.phone,
  serviceName: services.name,
  serviceDurationMinutes: services.durationMinutes,
  staffName: staff.name,
  staffColor: staff.color,
};

function toView(r: {
  appointment: Appointment;
  customerName: string | null;
  customerPhone: string;
  serviceName: Record<string, string>;
  serviceDurationMinutes: number;
  staffName: string;
  staffColor: string;
}): AppointmentView {
  const { appointment, ...rest } = r;
  return { ...appointment, ...rest };
}

export async function listAppointments(
  tx: Tx,
  businessId: string,
  filter: {
    from?: Date;
    to?: Date;
    staffId?: string | null;
    statuses?: AppointmentStatus[];
    customerId?: string;
    source?: AppointmentSource;
    search?: string;
    order?: "asc" | "desc";
    limit?: number;
  } = {},
): Promise<AppointmentView[]> {
  const conds: (SQL | undefined)[] = [eq(appointments.businessId, businessId)];
  if (filter.from) conds.push(gte(appointments.endsAt, filter.from));
  if (filter.to) conds.push(lt(appointments.startsAt, filter.to));
  if (filter.staffId) conds.push(eq(appointments.staffId, filter.staffId));
  if (filter.statuses?.length) conds.push(inArray(appointments.status, filter.statuses));
  if (filter.customerId) conds.push(eq(appointments.customerId, filter.customerId));
  if (filter.source) conds.push(eq(appointments.source, filter.source));
  if (filter.search) {
    const q = `%${filter.search.replace(/[%_]/g, "")}%`;
    conds.push(or(ilike(customers.name, q), ilike(customers.phone, q)));
  }
  const rows = await tx
    .select(viewColumns)
    .from(appointments)
    .innerJoin(customers, eq(customers.id, appointments.customerId))
    .innerJoin(services, eq(services.id, appointments.serviceId))
    .innerJoin(staff, eq(staff.id, appointments.staffId))
    .where(and(...conds))
    .orderBy(filter.order === "desc" ? desc(appointments.startsAt) : asc(appointments.startsAt))
    .limit(filter.limit ?? 500);
  return rows.map((r) => toView(r as Parameters<typeof toView>[0]));
}

export async function getAppointmentView(tx: Tx, businessId: string, id: string): Promise<AppointmentView | null> {
  const [row] = await tx
    .select(viewColumns)
    .from(appointments)
    .innerJoin(customers, eq(customers.id, appointments.customerId))
    .innerJoin(services, eq(services.id, appointments.serviceId))
    .innerJoin(staff, eq(staff.id, appointments.staffId))
    .where(and(eq(appointments.businessId, businessId), eq(appointments.id, id)));
  return row ? toView(row as Parameters<typeof toView>[0]) : null;
}

/** Upcoming (or all) active appointments for a customer phone — used by the AI agent. */
export async function findCustomerAppointments(
  tx: Tx,
  businessId: string,
  phone: string,
  opts: { upcomingOnly?: boolean; now?: Date } = {},
): Promise<AppointmentView[]> {
  const customer = await findCustomerByPhone(tx, businessId, phone);
  if (!customer) return [];
  return listAppointments(tx, businessId, {
    customerId: customer.id,
    from: opts.upcomingOnly === false ? undefined : (opts.now ?? new Date()),
    statuses: ["pending", "confirmed"],
  });
}

export async function countActiveAppointments(tx: Tx, businessId: string): Promise<number> {
  const [r] = await tx
    .select({ n: sql<number>`count(*)::int` })
    .from(appointments)
    .where(and(eq(appointments.businessId, businessId), ne(appointments.status, "cancelled")));
  return r?.n ?? 0;
}
