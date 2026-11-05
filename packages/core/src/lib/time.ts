import { DateTime } from "luxon";
import type { Locale } from "../db/schema";
import { INTL_LOCALE } from "./i18n";

export function toZoned(date: Date | string, timezone: string): DateTime {
  const dt = typeof date === "string" ? DateTime.fromISO(date) : DateTime.fromJSDate(date);
  return dt.setZone(timezone);
}

export function localDate(date: Date | string, timezone: string): string {
  return toZoned(date, timezone).toISODate()!;
}

export function todayLocal(timezone: string, now: Date = new Date()): string {
  return DateTime.fromJSDate(now).setZone(timezone).toISODate()!;
}

/** Billing period key "YYYY-MM" in the business timezone. */
export function periodKey(timezone: string, at: Date = new Date()): string {
  return DateTime.fromJSDate(at).setZone(timezone).toFormat("yyyy-MM");
}

const asDate = (date: Date | string) => (typeof date === "string" ? new Date(date) : date);

export function formatDate(
  date: Date | string,
  timezone: string,
  locale: Locale,
  opts: Intl.DateTimeFormatOptions = {},
): string {
  return new Intl.DateTimeFormat(INTL_LOCALE[locale], {
    weekday: "long",
    day: "numeric",
    month: "long",
    timeZone: timezone,
    ...opts,
  }).format(asDate(date));
}

export function formatTime(date: Date | string, timezone: string, locale: Locale): string {
  return new Intl.DateTimeFormat(INTL_LOCALE[locale], {
    hour: "numeric",
    minute: "2-digit",
    hour12: locale !== "fr",
    timeZone: timezone,
  }).format(asDate(date));
}

/** "Tuesday 12 November, 4:30 pm" — Arabic uses Lebanese month names (تشرين الثاني) and Latin digits. */
export function formatDateTime(date: Date | string, timezone: string, locale: Locale): string {
  const sep = locale === "ar" ? "، " : ", ";
  return formatDate(date, timezone, locale) + sep + formatTime(date, timezone, locale);
}

export function formatPrice(cents: number | null | undefined, opts: { from?: boolean; locale?: Locale } = {}): string {
  if (cents === null || cents === undefined) return "";
  const amount = cents / 100;
  const str = Number.isInteger(amount) ? "$" + amount : "$" + amount.toFixed(2);
  if (!opts.from) return str;
  if (opts.locale === "ar") return "ابتداءً من " + str;
  if (opts.locale === "fr") return "à partir de " + str;
  return "from " + str;
}
