import { DateTime } from "luxon";

/** Move `date` into the business-local sending window [startHour, endHour) — no messages at night. */
export function intoSendingWindow(date: Date, timezone: string, startHour = 10, endHour = 20): Date {
  let d = DateTime.fromJSDate(date).setZone(timezone);
  if (d.hour < startHour) d = d.set({ hour: startHour, minute: 0, second: 0, millisecond: 0 });
  else if (d.hour >= endHour) d = d.plus({ days: 1 }).set({ hour: startHour, minute: 0, second: 0, millisecond: 0 });
  return d.toJSDate();
}
