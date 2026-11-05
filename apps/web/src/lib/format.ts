/** Client+server safe formatting helpers (Intl + Luxon only). */
import { DateTime } from "luxon";
import type { Locale } from "@/i18n";

const INTL: Record<Locale, string> = { ar: "ar-LB-u-nu-latn", en: "en-GB", fr: "fr-FR" };

export const intlLocale = (l: Locale) => INTL[l];

export function fmtTime(iso: string, tz: string, locale: Locale) {
  return new Intl.DateTimeFormat(INTL[locale], { hour: "numeric", minute: "2-digit", hour12: locale !== "fr", timeZone: tz }).format(new Date(iso));
}

export function fmtDate(iso: string, tz: string, locale: Locale, opts: Intl.DateTimeFormatOptions = { weekday: "short", day: "numeric", month: "short" }) {
  return new Intl.DateTimeFormat(INTL[locale], { ...opts, timeZone: tz }).format(new Date(iso));
}

export function fmtDateTime(iso: string, tz: string, locale: Locale) {
  return `${fmtDate(iso, tz, locale)} · ${fmtTime(iso, tz, locale)}`;
}

/** Format a local ISO date (YYYY-MM-DD) without timezone shifting. */
export function fmtLocalDate(date: string, locale: Locale, opts: Intl.DateTimeFormatOptions = { weekday: "long", day: "numeric", month: "long" }) {
  return new Intl.DateTimeFormat(INTL[locale], { ...opts, timeZone: "UTC" }).format(new Date(`${date}T12:00:00Z`));
}

export function fmtPrice(cents: number | null | undefined, opts: { from?: boolean; showLbp?: boolean; lbpRate?: number } = {}) {
  if (cents === null || cents === undefined) return "";
  const usd = cents / 100;
  let s = `$${Number.isInteger(usd) ? usd : usd.toFixed(2)}`;
  if (opts.from) s = `${s}+`;
  if (opts.showLbp && opts.lbpRate) {
    const lbp = Math.round((usd * opts.lbpRate) / 1000) * 1000;
    s += ` (${lbp.toLocaleString("en-US")} LBP)`;
  }
  return s;
}

export function localDateOf(iso: string, tz: string) {
  return DateTime.fromISO(iso).setZone(tz).toISODate()!;
}

export function localClockOf(iso: string, tz: string) {
  return DateTime.fromISO(iso).setZone(tz).toFormat("HH:mm");
}

export function localToIso(date: string, clock: string, tz: string) {
  return DateTime.fromISO(`${date}T${clock}`, { zone: tz }).toUTC().toISO()!;
}

export function todayIn(tz: string) {
  return DateTime.now().setZone(tz).toISODate()!;
}
