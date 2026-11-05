/**
 * Availability engine — pure functions, no I/O.
 *
 * Semantics (documented in PROGRESS.md "Decisions"):
 * - Staff working hours come from the staff's own weekly rules; if a staff member
 *   has none, they inherit the business opening hours.
 * - The *service time* [start, start+duration) must fall inside a working window,
 *   outside breaks, time off and holidays.
 * - The *blocked window* [start-bufferBefore, end+bufferAfter) must not overlap any
 *   existing non-cancelled appointment's blocked window for the same staff (this is
 *   exactly what the DB exclusion constraint enforces). Buffers may extend past
 *   working hours (e.g. cleanup after the last patient).
 * - If the service needs a resource (room/chair), concurrent blocked windows on that
 *   resource must stay below its capacity.
 * - All instants are UTC epoch ms; wall-clock rules are interpreted in the business
 *   timezone with Luxon, so DST transitions are handled correctly.
 */
import { DateTime } from "luxon";

export type WeeklyRule = {
  /** ISO weekday: 1 = Monday … 7 = Sunday. */
  weekday: number;
  /** "HH:mm" or "HH:mm:ss" local wall-clock time. "24:00" = end of day. */
  start: string;
  end: string;
};

export type Instant = Date | string | number;

export type StaffInput = {
  id: string;
  sortOrder?: number;
  /** Staff weekly hours; empty → inherit business hours. */
  workingHours: WeeklyRule[];
  /** Staff-specific recurring breaks (business-wide breaks are passed separately). */
  breaks: WeeklyRule[];
  timeOff: { start: Instant; end: Instant }[];
  /** Staff-specific closures in local ISO dates (inclusive). */
  holidays: { startDate: string; endDate: string }[];
};

export type ExistingAppointment = {
  staffId: string;
  /** Blocked window, i.e. including buffers. */
  blockedStart: Instant;
  blockedEnd: Instant;
  resourceId?: string | null;
};

export type ServiceInput = {
  durationMinutes: number;
  bufferBeforeMinutes: number;
  bufferAfterMinutes: number;
  resourceId?: string | null;
};

export type AvailabilityRules = {
  minNoticeMinutes: number;
  maxDaysAhead: number;
  slotGranularityMinutes: number;
};

export type AvailabilityInput = {
  timezone: string;
  service: ServiceInput;
  /** Staff qualified for the service (already filtered by staff_services + active). */
  staff: StaffInput[];
  businessHours: WeeklyRule[];
  businessBreaks: WeeklyRule[];
  businessHolidays: { startDate: string; endDate: string }[];
  appointments: ExistingAppointment[];
  resources?: { id: string; capacity: number }[];
  rules: AvailabilityRules;
  now: Instant;
};

export type Slot = {
  /** UTC ISO start of the service time. */
  start: string;
  end: string;
  /** Available staff, best candidate first (least booked that day, then sort order). */
  staffIds: string[];
};

export type SlotRejection =
  | "holiday"
  | "outside_hours"
  | "break"
  | "time_off"
  | "conflict"
  | "resource_full"
  | "too_soon"
  | "too_far"
  | "unknown_staff";

type Interval = [number, number];

const MIN = 60_000;

const toMs = (i: Instant): number => (i instanceof Date ? i.getTime() : typeof i === "number" ? i : Date.parse(i));

const overlaps = (a: Interval, b: Interval) => a[0] < b[1] && b[0] < a[1];
const contains = (outer: Interval, inner: Interval) => outer[0] <= inner[0] && inner[1] <= outer[1];

function parseClock(clock: string): { h: number; m: number } {
  const [h = "0", m = "0"] = clock.split(":");
  return { h: Number(h), m: Number(m) };
}

/** Convert a local wall-clock time on a local date to UTC epoch ms (DST-safe). */
export function localToMs(date: string, clock: string, timezone: string): number {
  const { h, m } = parseClock(clock);
  const day = DateTime.fromISO(date, { zone: timezone }).startOf("day");
  if (h >= 24) return day.plus({ days: 1 }).toMillis();
  // DateTime.set on a non-existent local time (spring-forward gap) moves forward, which is what we want.
  return day.set({ hour: h, minute: m, second: 0, millisecond: 0 }).toMillis();
}

function rulesToIntervals(rules: WeeklyRule[], date: string, weekday: number, timezone: string): Interval[] {
  return rules
    .filter((r) => r.weekday === weekday)
    .map((r) => [localToMs(date, r.start, timezone), localToMs(date, r.end, timezone)] as Interval)
    .filter(([s, e]) => e > s)
    .sort((a, b) => a[0] - b[0]);
}

/** Subtract `cuts` from `base`, returning disjoint remaining intervals. */
export function subtractIntervals(base: Interval[], cuts: Interval[]): Interval[] {
  let result = base.map((i) => [...i] as Interval);
  for (const [cs, ce] of cuts) {
    const next: Interval[] = [];
    for (const [s, e] of result) {
      if (ce <= s || cs >= e) {
        next.push([s, e]);
        continue;
      }
      if (cs > s) next.push([s, cs]);
      if (ce < e) next.push([ce, e]);
    }
    result = next;
  }
  return result;
}

const dateInRanges = (date: string, ranges: { startDate: string; endDate: string }[]) =>
  ranges.some((r) => r.startDate <= date && date <= r.endDate);

type DayContext = {
  date: string;
  weekday: number;
  timezone: string;
  /** Free working windows per staff (after breaks/time off). */
  freeWindows: Map<string, Interval[]>;
  /** Raw working windows per staff (before cuts), for diagnostics. */
  rawWindows: Map<string, Interval[]>;
  breakCuts: Map<string, Interval[]>;
  timeOffCuts: Map<string, Interval[]>;
  closedStaff: Set<string>;
  businessClosed: boolean;
};

type Prepared = {
  input: AvailabilityInput;
  nowMs: number;
  earliestMs: number;
  lastBookableDate: string;
  apptsByStaff: Map<string, Interval[]>;
  apptsByResource: Map<string, Interval[]>;
  resourceCapacity: number | null;
  staffById: Map<string, StaffInput>;
};

function prepare(input: AvailabilityInput): Prepared {
  const nowMs = toMs(input.now);
  const apptsByStaff = new Map<string, Interval[]>();
  const apptsByResource = new Map<string, Interval[]>();
  for (const a of input.appointments) {
    const iv: Interval = [toMs(a.blockedStart), toMs(a.blockedEnd)];
    if (!apptsByStaff.has(a.staffId)) apptsByStaff.set(a.staffId, []);
    apptsByStaff.get(a.staffId)!.push(iv);
    if (a.resourceId) {
      if (!apptsByResource.has(a.resourceId)) apptsByResource.set(a.resourceId, []);
      apptsByResource.get(a.resourceId)!.push(iv);
    }
  }
  const resourceId = input.service.resourceId ?? null;
  const resourceCapacity = resourceId
    ? (input.resources?.find((r) => r.id === resourceId)?.capacity ?? 1)
    : null;
  const today = DateTime.fromMillis(nowMs, { zone: input.timezone }).startOf("day");
  return {
    input,
    nowMs,
    earliestMs: nowMs + input.rules.minNoticeMinutes * MIN,
    lastBookableDate: today.plus({ days: input.rules.maxDaysAhead }).toISODate()!,
    apptsByStaff,
    apptsByResource,
    resourceCapacity,
    staffById: new Map(input.staff.map((s) => [s.id, s])),
  };
}

function buildDay(p: Prepared, date: string): DayContext {
  const { input } = p;
  const tz = input.timezone;
  const weekday = DateTime.fromISO(date, { zone: tz }).weekday;
  const ctx: DayContext = {
    date,
    weekday,
    timezone: tz,
    freeWindows: new Map(),
    rawWindows: new Map(),
    breakCuts: new Map(),
    timeOffCuts: new Map(),
    closedStaff: new Set(),
    businessClosed: dateInRanges(date, input.businessHolidays),
  };
  if (ctx.businessClosed) return ctx;
  const businessBreaks = rulesToIntervals(input.businessBreaks, date, weekday, tz);
  const dayStart = localToMs(date, "00:00", tz);
  const dayEnd = localToMs(date, "24:00", tz);
  for (const s of input.staff) {
    if (dateInRanges(date, s.holidays)) {
      ctx.closedStaff.add(s.id);
      continue;
    }
    const rules = s.workingHours.length > 0 ? s.workingHours : input.businessHours;
    const raw = rulesToIntervals(rules, date, weekday, tz);
    const breaks = [...businessBreaks, ...rulesToIntervals(s.breaks, date, weekday, tz)];
    const timeOff = s.timeOff
      .map((t) => [toMs(t.start), toMs(t.end)] as Interval)
      .filter((iv) => overlaps(iv, [dayStart, dayEnd]));
    ctx.rawWindows.set(s.id, raw);
    ctx.breakCuts.set(s.id, breaks);
    ctx.timeOffCuts.set(s.id, timeOff);
    ctx.freeWindows.set(s.id, subtractIntervals(subtractIntervals(raw, breaks), timeOff));
  }
  return ctx;
}

function evaluate(p: Prepared, day: DayContext, staffId: string, startMs: number): SlotRejection | null {
  const { service } = p.input;
  if (!p.staffById.has(staffId)) return "unknown_staff";
  if (day.date > p.lastBookableDate) return "too_far";
  if (startMs < p.earliestMs) return "too_soon";
  if (day.businessClosed || day.closedStaff.has(staffId)) return "holiday";
  const svc: Interval = [startMs, startMs + service.durationMinutes * MIN];
  const free = day.freeWindows.get(staffId) ?? [];
  if (!free.some((w) => contains(w, svc))) {
    const raw = day.rawWindows.get(staffId) ?? [];
    if (!raw.some((w) => contains(w, svc))) return "outside_hours";
    if ((day.breakCuts.get(staffId) ?? []).some((b) => overlaps(b, svc))) return "break";
    return "time_off";
  }
  const blocked: Interval = [
    svc[0] - service.bufferBeforeMinutes * MIN,
    svc[1] + service.bufferAfterMinutes * MIN,
  ];
  if ((p.apptsByStaff.get(staffId) ?? []).some((a) => overlaps(a, blocked))) return "conflict";
  if (service.resourceId && p.resourceCapacity !== null) {
    const used = (p.apptsByResource.get(service.resourceId) ?? []).filter((a) => overlaps(a, blocked)).length;
    if (used >= p.resourceCapacity) return "resource_full";
  }
  return null;
}

function dailyLoad(p: Prepared, staffId: string, day: DayContext): number {
  const dayIv: Interval = [localToMs(day.date, "00:00", day.timezone), localToMs(day.date, "24:00", day.timezone)];
  return (p.apptsByStaff.get(staffId) ?? []).filter((a) => overlaps(a, dayIv)).length;
}

function* eachDate(fromDate: string, toDate: string, tz: string): Generator<string> {
  let d = DateTime.fromISO(fromDate, { zone: tz }).startOf("day");
  const end = DateTime.fromISO(toDate, { zone: tz }).startOf("day");
  let guard = 0;
  while (d <= end && guard++ < 400) {
    yield d.toISODate()!;
    d = d.plus({ days: 1 });
  }
}

/**
 * Compute bookable slots between two local dates (inclusive), optionally for one staff member.
 */
export function computeSlots(
  input: AvailabilityInput,
  range: { fromDate: string; toDate: string; staffId?: string | null },
): Slot[] {
  const p = prepare(input);
  const tz = input.timezone;
  const step = Math.max(5, input.rules.slotGranularityMinutes) * MIN;
  const staffList = range.staffId ? input.staff.filter((s) => s.id === range.staffId) : input.staff;
  const byStart = new Map<number, { end: number; staff: { id: string; load: number; sort: number }[] }>();

  for (const date of eachDate(range.fromDate, range.toDate, tz)) {
    if (date > p.lastBookableDate) break;
    const day = buildDay(p, date);
    if (day.businessClosed) continue;
    const midnight = localToMs(date, "00:00", tz);
    for (const s of staffList) {
      const windows = day.freeWindows.get(s.id);
      if (!windows?.length) continue;
      const load = dailyLoad(p, s.id, day);
      for (const [ws, we] of windows) {
        // Align to the granularity grid anchored at local midnight.
        let t = midnight + Math.ceil((ws - midnight) / step) * step;
        for (; t + input.service.durationMinutes * MIN <= we; t += step) {
          if (evaluate(p, day, s.id, t) !== null) continue;
          const entry = byStart.get(t) ?? { end: t + input.service.durationMinutes * MIN, staff: [] };
          entry.staff.push({ id: s.id, load, sort: s.sortOrder ?? 0 });
          byStart.set(t, entry);
        }
      }
    }
  }

  return [...byStart.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([start, { end, staff }]) => ({
      start: new Date(start).toISOString(),
      end: new Date(end).toISOString(),
      staffIds: staff.sort((a, b) => a.load - b.load || a.sort - b.sort).map((x) => x.id),
    }));
}

/**
 * Check one specific (staff, start) candidate. Used to re-validate inside the booking
 * transaction and to explain to the AI agent why a time does not work.
 * Does not require grid alignment.
 */
export function checkSlot(
  input: AvailabilityInput,
  staffId: string,
  start: Instant,
): { ok: true } | { ok: false; reason: SlotRejection } {
  const p = prepare(input);
  const startMs = toMs(start);
  const date = DateTime.fromMillis(startMs, { zone: input.timezone }).toISODate()!;
  const reason = evaluate(p, buildDay(p, date), staffId, startMs);
  return reason ? { ok: false, reason } : { ok: true };
}

/** Pick the best staff for a slot in "any staff" mode. */
export function pickStaff(slot: Slot): string | undefined {
  return slot.staffIds[0];
}
