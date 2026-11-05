import { describe, expect, it } from "vitest";
import { DateTime } from "luxon";
import {
  checkSlot,
  computeSlots,
  localToMs,
  subtractIntervals,
  type AvailabilityInput,
  type StaffInput,
  type WeeklyRule,
} from "../../src/availability/engine";

const TZ = "Asia/Beirut";
const MON_SAT_9_17: WeeklyRule[] = [1, 2, 3, 4, 5, 6].map((weekday) => ({ weekday, start: "09:00", end: "17:00" }));

function staff(id: string, extra: Partial<StaffInput> = {}): StaffInput {
  return { id, workingHours: [], breaks: [], timeOff: [], holidays: [], ...extra };
}

/** Local Beirut time → ISO UTC. */
const at = (local: string) => DateTime.fromISO(local, { zone: TZ }).toUTC().toISO()!;

function input(overrides: Partial<AvailabilityInput> = {}): AvailabilityInput {
  return {
    timezone: TZ,
    service: { durationMinutes: 30, bufferBeforeMinutes: 0, bufferAfterMinutes: 0 },
    staff: [staff("a")],
    businessHours: MON_SAT_9_17,
    businessBreaks: [],
    businessHolidays: [],
    appointments: [],
    rules: { minNoticeMinutes: 0, maxDaysAhead: 60, slotGranularityMinutes: 15 },
    // Sunday 2026-11-01 08:00 local — before the test days.
    now: at("2026-11-01T08:00"),
    ...overrides,
  };
}

const startsOn = (slots: { start: string }[]) =>
  slots.map((s) => DateTime.fromISO(s.start, { zone: TZ }).toFormat("HH:mm"));

describe("interval helpers", () => {
  it("subtracts cuts from windows", () => {
    expect(subtractIntervals([[0, 100]], [[20, 30], [50, 60]])).toEqual([[0, 20], [30, 50], [60, 100]]);
    expect(subtractIntervals([[0, 100]], [[-10, 200]])).toEqual([]);
    expect(subtractIntervals([[0, 100]], [[100, 200]])).toEqual([[0, 100]]);
  });
});

describe("computeSlots — basics", () => {
  it("generates 15-minute aligned slots inside working hours", () => {
    const slots = computeSlots(input(), { fromDate: "2026-11-02", toDate: "2026-11-02" });
    const times = startsOn(slots);
    expect(times[0]).toBe("09:00");
    expect(times.at(-1)).toBe("16:30"); // 30-min service must end by 17:00
    expect(times).toHaveLength(31); // 09:00 … 16:30 every 15 min
    expect(slots[0]!.staffIds).toEqual(["a"]);
  });

  it("respects a custom granularity", () => {
    const slots = computeSlots(input({ rules: { minNoticeMinutes: 0, maxDaysAhead: 60, slotGranularityMinutes: 60 } }), {
      fromDate: "2026-11-02",
      toDate: "2026-11-02",
    });
    expect(startsOn(slots)).toEqual(["09:00", "10:00", "11:00", "12:00", "13:00", "14:00", "15:00", "16:00"]);
  });

  it("returns nothing on a closed weekday (Sunday)", () => {
    expect(computeSlots(input(), { fromDate: "2026-11-08", toDate: "2026-11-08" })).toEqual([]);
  });

  it("uses staff-specific hours instead of business hours", () => {
    const s = staff("a", { workingHours: [{ weekday: 1, start: "13:00", end: "15:00" }] });
    const slots = computeSlots(input({ staff: [s] }), { fromDate: "2026-11-02", toDate: "2026-11-02" });
    expect(startsOn(slots)[0]).toBe("13:00");
    expect(startsOn(slots).at(-1)).toBe("14:30");
  });

  it("supports split shifts", () => {
    const s = staff("a", {
      workingHours: [
        { weekday: 1, start: "09:00", end: "10:00" },
        { weekday: 1, start: "16:00", end: "17:00" },
      ],
    });
    const slots = computeSlots(input({ staff: [s], service: { durationMinutes: 60, bufferBeforeMinutes: 0, bufferAfterMinutes: 0 } }), {
      fromDate: "2026-11-02",
      toDate: "2026-11-02",
    });
    expect(startsOn(slots)).toEqual(["09:00", "16:00"]);
  });

  it("aligns slots to the grid even when hours start off-grid", () => {
    const s = staff("a", { workingHours: [{ weekday: 1, start: "09:10", end: "10:00" }] });
    expect(startsOn(computeSlots(input({ staff: [s] }), { fromDate: "2026-11-02", toDate: "2026-11-02" }))).toEqual([
      "09:15",
      "09:30",
    ]);
  });
});

describe("computeSlots — breaks, time off, holidays", () => {
  it("excludes business-wide breaks", () => {
    const slots = computeSlots(
      input({ businessBreaks: [{ weekday: 1, start: "13:00", end: "14:00" }] }),
      { fromDate: "2026-11-02", toDate: "2026-11-02" },
    );
    const t = startsOn(slots);
    expect(t).toContain("12:30");
    expect(t).not.toContain("12:45"); // would run into the break
    expect(t).not.toContain("13:00");
    expect(t).not.toContain("13:30");
    expect(t).toContain("14:00");
  });

  it("excludes staff breaks only for that staff", () => {
    const a = staff("a", { breaks: [{ weekday: 1, start: "12:00", end: "13:00" }] });
    const b = staff("b");
    const slots = computeSlots(input({ staff: [a, b] }), { fromDate: "2026-11-02", toDate: "2026-11-02" });
    const noon = slots.find((s) => startsOn([s])[0] === "12:00")!;
    expect(noon.staffIds).toEqual(["b"]);
  });

  it("excludes staff time off (partial day)", () => {
    const a = staff("a", { timeOff: [{ start: at("2026-11-02T09:00"), end: at("2026-11-02T12:00") }] });
    const t = startsOn(computeSlots(input({ staff: [a] }), { fromDate: "2026-11-02", toDate: "2026-11-02" }));
    expect(t[0]).toBe("12:00");
  });

  it("excludes multi-day time off", () => {
    const a = staff("a", { timeOff: [{ start: at("2026-11-02T00:00"), end: at("2026-11-04T00:00") }] });
    const slots = computeSlots(input({ staff: [a] }), { fromDate: "2026-11-02", toDate: "2026-11-04" });
    expect(new Set(slots.map((s) => DateTime.fromISO(s.start, { zone: TZ }).toISODate()))).toEqual(new Set(["2026-11-04"]));
  });

  it("closes the whole business on holidays", () => {
    const slots = computeSlots(
      input({ staff: [staff("a"), staff("b")], businessHolidays: [{ startDate: "2026-11-22", endDate: "2026-11-23" }] }),
      { fromDate: "2026-11-21", toDate: "2026-11-24" },
    );
    const dates = new Set(slots.map((s) => DateTime.fromISO(s.start, { zone: TZ }).toISODate()));
    expect(dates).toEqual(new Set(["2026-11-21", "2026-11-24"]));
  });

  it("closes one staff member on a staff holiday", () => {
    const slots = computeSlots(
      input({ staff: [staff("a", { holidays: [{ startDate: "2026-11-02", endDate: "2026-11-02" }] }), staff("b")] }),
      { fromDate: "2026-11-02", toDate: "2026-11-02" },
    );
    expect(slots.every((s) => s.staffIds.join() === "b")).toBe(true);
  });
});

describe("computeSlots — existing appointments and buffers", () => {
  it("blocks overlapping times but allows back-to-back bookings", () => {
    const appts = [{ staffId: "a", blockedStart: at("2026-11-02T10:00"), blockedEnd: at("2026-11-02T10:30") }];
    const t = startsOn(computeSlots(input({ appointments: appts }), { fromDate: "2026-11-02", toDate: "2026-11-02" }));
    expect(t).toContain("09:30"); // ends exactly at 10:00
    expect(t).not.toContain("09:45");
    expect(t).not.toContain("10:00");
    expect(t).not.toContain("10:15");
    expect(t).toContain("10:30"); // starts exactly when the other ends
  });

  it("applies the new service's buffers", () => {
    const appts = [{ staffId: "a", blockedStart: at("2026-11-02T10:00"), blockedEnd: at("2026-11-02T10:30") }];
    const t = startsOn(
      computeSlots(
        input({ appointments: appts, service: { durationMinutes: 30, bufferBeforeMinutes: 15, bufferAfterMinutes: 15 } }),
        { fromDate: "2026-11-02", toDate: "2026-11-02" },
      ),
    );
    expect(t).not.toContain("09:30"); // its after-buffer 10:00-10:15 overlaps
    expect(t).toContain("09:15");
    expect(t).not.toContain("10:30"); // its before-buffer 10:15-10:30 overlaps? no — 10:15..10:30 vs 10:00..10:30 overlaps
    expect(t).toContain("10:45");
  });

  it("respects existing appointments' buffers (blocked window)", () => {
    // Existing 10:00-10:30 with 15 min cleanup → blocked until 10:45.
    const appts = [{ staffId: "a", blockedStart: at("2026-11-02T10:00"), blockedEnd: at("2026-11-02T10:45") }];
    const t = startsOn(computeSlots(input({ appointments: appts }), { fromDate: "2026-11-02", toDate: "2026-11-02" }));
    expect(t).not.toContain("10:30");
    expect(t).toContain("10:45");
  });

  it("lets buffers extend past closing time", () => {
    const t = startsOn(
      computeSlots(input({ service: { durationMinutes: 30, bufferBeforeMinutes: 0, bufferAfterMinutes: 30 } }), {
        fromDate: "2026-11-02",
        toDate: "2026-11-02",
      }),
    );
    expect(t.at(-1)).toBe("16:30");
  });

  it("frees a slot when the appointment is removed (cancelled)", () => {
    const appts = [{ staffId: "a", blockedStart: at("2026-11-02T10:00"), blockedEnd: at("2026-11-02T10:30") }];
    const before = startsOn(computeSlots(input({ appointments: appts }), { fromDate: "2026-11-02", toDate: "2026-11-02" }));
    const after = startsOn(computeSlots(input({ appointments: [] }), { fromDate: "2026-11-02", toDate: "2026-11-02" }));
    expect(before).not.toContain("10:00");
    expect(after).toContain("10:00");
  });

  it("another staff member's appointment does not block", () => {
    const appts = [{ staffId: "b", blockedStart: at("2026-11-02T10:00"), blockedEnd: at("2026-11-02T10:30") }];
    const t = startsOn(computeSlots(input({ appointments: appts }), { fromDate: "2026-11-02", toDate: "2026-11-02" }));
    expect(t).toContain("10:00");
  });
});

describe("computeSlots — notice and horizon", () => {
  it("enforces minimum notice", () => {
    const slots = computeSlots(input({ now: at("2026-11-02T11:05"), rules: { minNoticeMinutes: 120, maxDaysAhead: 60, slotGranularityMinutes: 15 } }), {
      fromDate: "2026-11-02",
      toDate: "2026-11-02",
    });
    expect(startsOn(slots)[0]).toBe("13:15");
  });

  it("enforces max days ahead", () => {
    const slots = computeSlots(input({ rules: { minNoticeMinutes: 0, maxDaysAhead: 2, slotGranularityMinutes: 15 } }), {
      fromDate: "2026-11-02",
      toDate: "2026-11-10",
    });
    const dates = new Set(slots.map((s) => DateTime.fromISO(s.start, { zone: TZ }).toISODate()));
    // now = Sun 1 Nov; +2 days → up to Tue 3 Nov.
    expect(dates).toEqual(new Set(["2026-11-02", "2026-11-03"]));
  });
});

describe("computeSlots — any staff", () => {
  it("lists all free staff with the least-booked first", () => {
    const appts = [
      { staffId: "a", blockedStart: at("2026-11-02T15:00"), blockedEnd: at("2026-11-02T15:30") },
      { staffId: "a", blockedStart: at("2026-11-02T16:00"), blockedEnd: at("2026-11-02T16:30") },
      { staffId: "b", blockedStart: at("2026-11-02T15:00"), blockedEnd: at("2026-11-02T15:30") },
    ];
    const slots = computeSlots(input({ staff: [staff("a", { sortOrder: 0 }), staff("b", { sortOrder: 1 }), staff("c", { sortOrder: 2 })], appointments: appts }), {
      fromDate: "2026-11-02",
      toDate: "2026-11-02",
    });
    expect(slots[0]!.staffIds).toEqual(["c", "b", "a"]);
  });

  it("uses sort order to break ties", () => {
    const slots = computeSlots(input({ staff: [staff("b", { sortOrder: 2 }), staff("a", { sortOrder: 1 })] }), {
      fromDate: "2026-11-02",
      toDate: "2026-11-02",
    });
    expect(slots[0]!.staffIds).toEqual(["a", "b"]);
  });

  it("filters to a single staff member when requested", () => {
    const slots = computeSlots(input({ staff: [staff("a"), staff("b")] }), {
      fromDate: "2026-11-02",
      toDate: "2026-11-02",
      staffId: "b",
    });
    expect(slots.every((s) => s.staffIds.join() === "b")).toBe(true);
  });
});

describe("computeSlots — resources", () => {
  it("limits concurrent bookings by resource capacity", () => {
    const appts = [
      { staffId: "a", blockedStart: at("2026-11-02T10:00"), blockedEnd: at("2026-11-02T11:00"), resourceId: "room" },
    ];
    const base = input({
      staff: [staff("a"), staff("b")],
      service: { durationMinutes: 30, bufferBeforeMinutes: 0, bufferAfterMinutes: 0, resourceId: "room" },
      appointments: appts,
      resources: [{ id: "room", capacity: 1 }],
    });
    const t = startsOn(computeSlots(base, { fromDate: "2026-11-02", toDate: "2026-11-02" }));
    expect(t).not.toContain("10:00"); // b is free but the only room is taken
    const roomy = startsOn(
      computeSlots({ ...base, resources: [{ id: "room", capacity: 2 }] }, { fromDate: "2026-11-02", toDate: "2026-11-02" }),
    );
    expect(roomy).toContain("10:00");
  });
});

describe("DST (Asia/Beirut)", () => {
  // Lebanon: DST starts last Sunday of March at 00:00 (→01:00), ends last Sunday of October at 00:00 (→23:00 Sat).
  it("maps local 09:00 to the right UTC instant on both sides of the spring transition", () => {
    const sixDaysHours = [1, 2, 3, 4, 5, 6, 7].map((weekday) => ({ weekday, start: "09:00", end: "10:00" }));
    const slots = computeSlots(input({ businessHours: sixDaysHours, now: at("2027-03-20T00:00") }), {
      fromDate: "2027-03-27",
      toDate: "2027-03-28",
    });
    const nineOClock = slots.filter((s) => startsOn([s])[0] === "09:00").map((s) => s.start);
    expect(nineOClock).toEqual(["2027-03-27T07:00:00.000Z", "2027-03-28T06:00:00.000Z"]);
  });

  it("handles the non-existent hour on the spring-forward night", () => {
    const hours = [{ weekday: 7, start: "00:00", end: "02:00" }];
    const slots = computeSlots(
      input({ businessHours: hours, now: at("2027-03-20T00:00"), service: { durationMinutes: 60, bufferBeforeMinutes: 0, bufferAfterMinutes: 0 } }),
      { fromDate: "2027-03-28", toDate: "2027-03-28" },
    );
    // 00:00–01:00 does not exist that night; only one real hour (01:00–02:00) remains.
    expect(startsOn(slots)).toEqual(["01:00"]);
  });

  it("uses real elapsed time across the autumn fall-back (repeated hour)", () => {
    // Sat 2026-10-24 23:00 → Sun 00:00 spans two real hours (clocks go back at midnight).
    const hours = [{ weekday: 6, start: "23:00", end: "24:00" }];
    const slots = computeSlots(
      input({ businessHours: hours, now: at("2026-10-20T00:00"), service: { durationMinutes: 60, bufferBeforeMinutes: 0, bufferAfterMinutes: 0 } }),
      { fromDate: "2026-10-24", toDate: "2026-10-24" },
    );
    expect(slots.map((s) => s.start)).toEqual([
      "2026-10-24T20:00:00.000Z",
      "2026-10-24T20:15:00.000Z",
      "2026-10-24T20:30:00.000Z",
      "2026-10-24T20:45:00.000Z",
      "2026-10-24T21:00:00.000Z",
    ]);
  });

  it("maps local 09:00 correctly after the autumn transition", () => {
    const slots = computeSlots(input({ now: at("2026-10-20T00:00") }), { fromDate: "2026-10-24", toDate: "2026-10-26" });
    const nine = slots.filter((s) => startsOn([s])[0] === "09:00").map((s) => s.start);
    // Sat 24 Oct (UTC+3) and Mon 26 Oct (UTC+2); Sunday closed.
    expect(nine).toEqual(["2026-10-24T06:00:00.000Z", "2026-10-26T07:00:00.000Z"]);
  });

  it("localToMs handles 24:00 as the next local midnight", () => {
    expect(new Date(localToMs("2026-11-02", "24:00", TZ)).toISOString()).toBe("2026-11-02T22:00:00.000Z");
  });
});

describe("checkSlot", () => {
  const appts = [{ staffId: "a", blockedStart: at("2026-11-02T10:00"), blockedEnd: at("2026-11-02T10:30") }];
  const base = input({ appointments: appts, businessBreaks: [{ weekday: 1, start: "13:00", end: "14:00" }] });

  it("accepts a free time, even off-grid", () => {
    expect(checkSlot(base, "a", at("2026-11-02T11:10"))).toEqual({ ok: true });
  });
  it("explains rejections", () => {
    expect(checkSlot(base, "a", at("2026-11-02T10:15"))).toEqual({ ok: false, reason: "conflict" });
    expect(checkSlot(base, "a", at("2026-11-02T13:15"))).toEqual({ ok: false, reason: "break" });
    expect(checkSlot(base, "a", at("2026-11-02T18:00"))).toEqual({ ok: false, reason: "outside_hours" });
    expect(checkSlot(base, "a", at("2026-11-08T10:00"))).toEqual({ ok: false, reason: "outside_hours" });
    expect(checkSlot(base, "zzz", at("2026-11-02T11:00"))).toEqual({ ok: false, reason: "unknown_staff" });
    expect(checkSlot({ ...base, now: at("2026-11-02T10:50"), rules: { ...base.rules, minNoticeMinutes: 60 } }, "a", at("2026-11-02T11:00"))).toEqual({
      ok: false,
      reason: "too_soon",
    });
    expect(checkSlot({ ...base, rules: { ...base.rules, maxDaysAhead: 3 } }, "a", at("2026-11-20T11:00"))).toEqual({
      ok: false,
      reason: "too_far",
    });
    expect(
      checkSlot({ ...base, businessHolidays: [{ startDate: "2026-11-02", endDate: "2026-11-02" }] }, "a", at("2026-11-02T11:00")),
    ).toEqual({ ok: false, reason: "holiday" });
  });
});
