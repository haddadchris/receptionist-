/**
 * Human, spoken-style date/time phrasing — what a Lebanese receptionist would
 * actually say ("yom el talata 12 tishrin el tene, sa3a 4 w nos"). Used in
 * chat replies and, importantly, for TTS in the voice agent where "16:30"
 * read literally sounds robotic.
 */
import { DateTime } from "luxon";
import type { ConversationLanguage } from "../db/schema";

const AR_WEEKDAYS = ["الاثنين", "الثلاثاء", "الأربعاء", "الخميس", "الجمعة", "السبت", "الأحد"];
const AR_MONTHS = ["كانون التاني", "شباط", "آذار", "نيسان", "أيار", "حزيران", "تموز", "آب", "أيلول", "تشرين الأول", "تشرين التاني", "كانون الأول"];
const AZ_WEEKDAYS = ["tanen", "talata", "arb3a", "khamis", "jem3a", "sabet", "a7ad"];
const AZ_MONTHS = ["kenoun el tene", "shbat", "adar", "nisan", "ayyar", "7zayran", "tammouz", "ab", "aylul", "tishrin el awwal", "tishrin el tene", "kenoun el awwal"];
const AR_HOURS = ["", "وحدة", "تنتين", "تلاتة", "أربعة", "خمسة", "ستة", "سبعة", "تمانية", "تسعة", "عشرة", "حدعش", "طنعش"];

function hour12(h: number) {
  const x = h % 12;
  return x === 0 ? 12 : x;
}

function arDayPart(h: number): string {
  if (h < 12) return "الصبح";
  if (h === 12) return "الضهر";
  if (h < 17) return "بعد الضهر";
  return "المسا";
}

function azDayPart(h: number): string {
  if (h < 12) return "el sobo7";
  if (h === 12) return "el dohr";
  if (h < 17) return "ba3d el dohr";
  return "el masa";
}

/** "الساعة أربعة ونص بعد الضهر" */
export function spokenTimeAr(dt: DateTime): string {
  const h = dt.hour;
  const m = dt.minute;
  let base: string;
  if (m === 0) base = `الساعة ${AR_HOURS[hour12(h)]}`;
  else if (m === 30) base = `الساعة ${AR_HOURS[hour12(h)]} ونص`;
  else if (m === 15) base = `الساعة ${AR_HOURS[hour12(h)]} وربع`;
  else if (m === 45) base = `الساعة ${AR_HOURS[hour12(h + 1)]} إلا ربع`;
  else base = `الساعة ${hour12(h)}:${String(m).padStart(2, "0")}`;
  return `${base} ${arDayPart(m === 45 ? h + 1 : h)}`;
}

/** "sa3a 4 w nos ba3d el dohr" */
export function spokenTimeArabizi(dt: DateTime): string {
  const h = dt.hour;
  const m = dt.minute;
  let base: string;
  if (m === 0) base = `sa3a ${hour12(h)}`;
  else if (m === 30) base = `sa3a ${hour12(h)} w nos`;
  else if (m === 15) base = `sa3a ${hour12(h)} w rebe3`;
  else if (m === 45) base = `sa3a ${hour12(h + 1)} ella rebe3`;
  else base = `sa3a ${hour12(h)}:${String(m).padStart(2, "0")}`;
  return `${base} ${azDayPart(m === 45 ? h + 1 : h)}`;
}

export function spokenTimeEn(dt: DateTime): string {
  const h = hour12(dt.hour);
  const ampm = dt.hour < 12 ? "am" : "pm";
  return dt.minute === 0 ? `${h} ${ampm}` : `${h}:${String(dt.minute).padStart(2, "0")} ${ampm}`;
}

export function spokenTimeFr(dt: DateTime): string {
  return dt.minute === 0 ? `${dt.hour}h` : `${dt.hour}h${String(dt.minute).padStart(2, "0")}`;
}

/** Relative day word when close ("today", "tomorrow"), else weekday + date. */
export function spokenDay(dt: DateTime, lang: ConversationLanguage, now: DateTime): string {
  const days = Math.round(dt.startOf("day").diff(now.startOf("day"), "days").days);
  const wd = dt.weekday - 1;
  switch (lang) {
    case "ar":
      if (days === 0) return "اليوم";
      if (days === 1) return "بكرا";
      if (days === 2) return "بعد بكرا";
      return `يوم ${AR_WEEKDAYS[wd]} ${dt.day} ${AR_MONTHS[dt.month - 1]}`;
    case "arabizi":
      if (days === 0) return "lyom";
      if (days === 1) return "bukra";
      if (days === 2) return "ba3d bukra";
      return `yom el ${AZ_WEEKDAYS[wd]} ${dt.day} ${AZ_MONTHS[dt.month - 1]}`;
    case "fr":
      if (days === 0) return "aujourd'hui";
      if (days === 1) return "demain";
      return dt.setLocale("fr").toFormat("cccc d LLLL");
    default:
      if (days === 0) return "today";
      if (days === 1) return "tomorrow";
      return dt.setLocale("en-GB").toFormat("cccc d LLLL");
  }
}

export function spokenTime(dt: DateTime, lang: ConversationLanguage): string {
  switch (lang) {
    case "ar":
      return spokenTimeAr(dt);
    case "arabizi":
      return spokenTimeArabizi(dt);
    case "fr":
      return spokenTimeFr(dt);
    default:
      return spokenTimeEn(dt);
  }
}

/** Full phrase: "yom el talata 12 tishrin el tene, sa3a 4 w nos ba3d el dohr". */
export function spokenDateTime(iso: string | Date, tz: string, lang: ConversationLanguage, now: Date = new Date()): string {
  const dt = (typeof iso === "string" ? DateTime.fromISO(iso) : DateTime.fromJSDate(iso)).setZone(tz);
  const n = DateTime.fromJSDate(now).setZone(tz);
  const sep = lang === "ar" ? "، " : ", ";
  const at = lang === "fr" ? " à " : sep;
  return `${spokenDay(dt, lang, n)}${at}${spokenTime(dt, lang)}`;
}

/** Read a Lebanese phone number in digit groups for TTS: "+961 3 123 456" → "03 123 456". */
export function spokenPhone(e164: string): string {
  if (e164.startsWith("+961")) {
    const local = e164.slice(4);
    const prefix = local.length === 7 ? `0${local[0]}` : local.slice(0, 2);
    const rest = local.length === 7 ? local.slice(1) : local.slice(2);
    return `${prefix} ${rest.slice(0, 3)} ${rest.slice(3)}`;
  }
  return e164.replace(/(\d{3})(?=\d)/g, "$1 ");
}
