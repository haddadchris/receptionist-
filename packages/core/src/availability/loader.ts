/**
 * Loads everything the pure availability engine needs from the database.
 * Must be called with a tenant-scoped transaction.
 */
import { and, eq, gt, inArray, isNull, lt, ne, or, gte, lte } from "drizzle-orm";
import { DateTime } from "luxon";
import type { Tx } from "../db/tenant";
import {
  appointments,
  breaks,
  businesses,
  DEFAULT_BOOKING_SETTINGS,
  holidays,
  resources,
  services,
  staff,
  staffServices,
  timeOff,
  workingHours,
  type Business,
  type Service,
  type Staff,
} from "../db/schema";
import { DomainError } from "../lib/errors";
import type { AvailabilityInput, WeeklyRule } from "./engine";

export type Channel = "public" | "internal";

export type LoadOptions = {
  serviceId: string;
  /** Restrict to one staff member (still validated as qualified). */
  staffId?: string | null;
  fromDate: string;
  toDate: string;
  /** public = booking page / AI channels: respects bookable_online flags. */
  channel: Channel;
  /** Ignore this appointment (used when rescheduling it). */
  excludeAppointmentId?: string | null;
  now?: Date;
};

export type LoadedAvailability = {
  input: AvailabilityInput;
  business: Business;
  service: Service;
  staff: Staff[];
};

const clock = (t: string) => t.slice(0, 5);
const rule = (r: { weekday: number; startTime: string; endTime: string }): WeeklyRule => ({
  weekday: r.weekday,
  start: clock(r.startTime),
  end: r.endTime.startsWith("24") ? "24:00" : clock(r.endTime),
});

export async function getBusiness(tx: Tx, businessId: string): Promise<Business> {
  const [b] = await tx.select().from(businesses).where(eq(businesses.id, businessId));
  if (!b) throw new DomainError("NOT_FOUND", "Business not found");
  return b;
}

export function bookingSettings(b: Business) {
  return { ...DEFAULT_BOOKING_SETTINGS, ...(b.bookingSettings ?? {}) };
}

/** Staff qualified to perform a service. */
export async function qualifiedStaff(tx: Tx, businessId: string, serviceId: string, channel: Channel): Promise<Staff[]> {
  const rows = await tx
    .select({ staff })
    .from(staffServices)
    .innerJoin(staff, eq(staff.id, staffServices.staffId))
    .where(
      and(
        eq(staffServices.businessId, businessId),
        eq(staffServices.serviceId, serviceId),
        eq(staff.active, true),
        channel === "public" ? eq(staff.bookableOnline, true) : undefined,
      ),
    )
    .orderBy(staff.sortOrder, staff.name);
  return rows.map((r) => r.staff);
}

export async function loadAvailability(tx: Tx, businessId: string, opts: LoadOptions): Promise<LoadedAvailability> {
  const business = await getBusiness(tx, businessId);
  const settings = bookingSettings(business);
  const [service] = await tx
    .select()
    .from(services)
    .where(and(eq(services.id, opts.serviceId), eq(services.businessId, businessId)));
  if (!service || !service.active) throw new DomainError("NOT_FOUND", "Service not found");
  if (opts.channel === "public" && !service.bookableOnline) throw new DomainError("NOT_FOUND", "Service not bookable online");

  let staffList = await qualifiedStaff(tx, businessId, service.id, opts.channel);
  if (opts.staffId) {
    staffList = staffList.filter((s) => s.id === opts.staffId);
    if (staffList.length === 0) {
      if (opts.channel === "internal") {
        // Dashboard may book a staff member who isn't formally linked to the service.
        const [s] = await tx
          .select()
          .from(staff)
          .where(and(eq(staff.id, opts.staffId), eq(staff.businessId, businessId)));
        if (!s) throw new DomainError("NOT_FOUND", "Staff not found");
        staffList = [s];
      } else {
        throw new DomainError("VALIDATION", "This staff member does not perform this service");
      }
    }
  }
  const staffIds = staffList.map((s) => s.id);
  const tz = business.timezone;
  // Pad the window by a day on each side to catch appointments/time off crossing midnight.
  const windowStart = DateTime.fromISO(opts.fromDate, { zone: tz }).minus({ days: 1 }).toJSDate();
  const windowEnd = DateTime.fromISO(opts.toDate, { zone: tz }).plus({ days: 2 }).toJSDate();

  const [hours, brks, offs, hols, appts, res] = await Promise.all([
    tx
      .select()
      .from(workingHours)
      .where(
        and(
          eq(workingHours.businessId, businessId),
          staffIds.length ? or(isNull(workingHours.staffId), inArray(workingHours.staffId, staffIds)) : isNull(workingHours.staffId),
        ),
      ),
    tx
      .select()
      .from(breaks)
      .where(
        and(
          eq(breaks.businessId, businessId),
          staffIds.length ? or(isNull(breaks.staffId), inArray(breaks.staffId, staffIds)) : isNull(breaks.staffId),
        ),
      ),
    staffIds.length
      ? tx
          .select()
          .from(timeOff)
          .where(
            and(
              eq(timeOff.businessId, businessId),
              inArray(timeOff.staffId, staffIds),
              lt(timeOff.startsAt, windowEnd),
              gt(timeOff.endsAt, windowStart),
            ),
          )
      : Promise.resolve([]),
    tx
      .select()
      .from(holidays)
      .where(
        and(
          eq(holidays.businessId, businessId),
          lte(holidays.startDate, opts.toDate),
          gte(holidays.endDate, opts.fromDate),
        ),
      ),
    staffIds.length || service.resourceId
      ? tx
          .select({
            id: appointments.id,
            staffId: appointments.staffId,
            blockedStart: appointments.blockedStart,
            blockedEnd: appointments.blockedEnd,
            resourceId: appointments.resourceId,
          })
          .from(appointments)
          .where(
            and(
              eq(appointments.businessId, businessId),
              ne(appointments.status, "cancelled"),
              lt(appointments.blockedStart, windowEnd),
              gt(appointments.blockedEnd, windowStart),
              or(
                staffIds.length ? inArray(appointments.staffId, staffIds) : undefined,
                service.resourceId ? eq(appointments.resourceId, service.resourceId) : undefined,
              ),
              opts.excludeAppointmentId ? ne(appointments.id, opts.excludeAppointmentId) : undefined,
            ),
          )
      : Promise.resolve([]),
    service.resourceId
      ? tx.select().from(resources).where(and(eq(resources.businessId, businessId), eq(resources.id, service.resourceId)))
      : Promise.resolve([]),
  ]);

  const input: AvailabilityInput = {
    timezone: tz,
    service: {
      durationMinutes: service.durationMinutes,
      bufferBeforeMinutes: service.bufferBeforeMinutes,
      bufferAfterMinutes: service.bufferAfterMinutes,
      resourceId: service.resourceId,
    },
    staff: staffList.map((s) => ({
      id: s.id,
      sortOrder: s.sortOrder,
      workingHours: hours.filter((h) => h.staffId === s.id).map(rule),
      breaks: brks.filter((b) => b.staffId === s.id).map(rule),
      timeOff: offs.filter((o) => o.staffId === s.id).map((o) => ({ start: o.startsAt, end: o.endsAt })),
      holidays: hols.filter((h) => h.staffId === s.id).map((h) => ({ startDate: h.startDate, endDate: h.endDate })),
    })),
    businessHours: hours.filter((h) => h.staffId === null).map(rule),
    businessBreaks: brks.filter((b) => b.staffId === null).map(rule),
    businessHolidays: hols.filter((h) => h.staffId === null).map((h) => ({ startDate: h.startDate, endDate: h.endDate })),
    appointments: appts.map((a) => ({
      staffId: a.staffId,
      blockedStart: a.blockedStart,
      blockedEnd: a.blockedEnd,
      resourceId: a.resourceId,
    })),
    resources: res.map((r) => ({ id: r.id, capacity: r.capacity })),
    rules: {
      minNoticeMinutes: opts.channel === "internal" ? 0 : settings.minNoticeMinutes,
      maxDaysAhead: opts.channel === "internal" ? 366 : settings.maxDaysAhead,
      slotGranularityMinutes: settings.slotGranularityMinutes,
    },
    now: opts.now ?? new Date(),
  };
  return { input, business, service, staff: staffList };
}

/** All active staff with their hours/breaks/time off/holidays — for calendar shading. */
export async function loadCalendarInput(tx: Tx, businessId: string, fromDate: string, toDate: string): Promise<AvailabilityInput> {
  const business = await getBusiness(tx, businessId);
  const staffList = await tx
    .select()
    .from(staff)
    .where(and(eq(staff.businessId, businessId), eq(staff.active, true)))
    .orderBy(staff.sortOrder, staff.name);
  const tz = business.timezone;
  const windowStart = DateTime.fromISO(fromDate, { zone: tz }).minus({ days: 1 }).toJSDate();
  const windowEnd = DateTime.fromISO(toDate, { zone: tz }).plus({ days: 2 }).toJSDate();
  const [hours, brks, offs, hols] = await Promise.all([
    tx.select().from(workingHours).where(eq(workingHours.businessId, businessId)),
    tx.select().from(breaks).where(eq(breaks.businessId, businessId)),
    tx
      .select()
      .from(timeOff)
      .where(and(eq(timeOff.businessId, businessId), lt(timeOff.startsAt, windowEnd), gt(timeOff.endsAt, windowStart))),
    tx
      .select()
      .from(holidays)
      .where(and(eq(holidays.businessId, businessId), lte(holidays.startDate, toDate), gte(holidays.endDate, fromDate))),
  ]);
  return {
    timezone: tz,
    service: { durationMinutes: 15, bufferBeforeMinutes: 0, bufferAfterMinutes: 0 },
    staff: staffList.map((s) => ({
      id: s.id,
      sortOrder: s.sortOrder,
      workingHours: hours.filter((h) => h.staffId === s.id).map(rule),
      breaks: brks.filter((b) => b.staffId === s.id).map(rule),
      timeOff: offs.filter((o) => o.staffId === s.id).map((o) => ({ start: o.startsAt, end: o.endsAt })),
      holidays: hols.filter((h) => h.staffId === s.id).map((h) => ({ startDate: h.startDate, endDate: h.endDate })),
    })),
    businessHours: hours.filter((h) => h.staffId === null).map(rule),
    businessBreaks: brks.filter((b) => b.staffId === null).map(rule),
    businessHolidays: hols.filter((h) => h.staffId === null).map((h) => ({ startDate: h.startDate, endDate: h.endDate })),
    appointments: [],
    rules: { minNoticeMinutes: 0, maxDaysAhead: 3660, slotGranularityMinutes: 15 },
    now: new Date(0),
  };
}
