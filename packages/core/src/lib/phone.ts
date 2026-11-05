import { parsePhoneNumberFromString, type CountryCode } from "libphonenumber-js";

const ARABIC_INDIC_ZERO = 0x0660;
const PERSIAN_ZERO = 0x06f0;

/**
 * Normalize a phone number to E.164. Lebanon (+961) is the default country, so
 * local formats like "03 123 456", "70-123456" or "009613123456" all work.
 * Returns null when the input is not a plausible phone number.
 */
export function normalizePhone(input: string | null | undefined, defaultCountry: CountryCode = "LB"): string | null {
  if (!input) return null;
  let raw = String(input).trim().replace(/[\s\-().]/g, "");
  // Arabic-Indic and Persian digits → ASCII.
  raw = raw
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - ARABIC_INDIC_ZERO))
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - PERSIAN_ZERO));
  if (raw.startsWith("00")) raw = "+" + raw.slice(2);
  if (/^961\d{7,8}$/.test(raw)) raw = "+" + raw;
  const parsed = parsePhoneNumberFromString(raw, defaultCountry);
  if (!parsed || !parsed.isPossible()) return null;
  return parsed.number;
}

/** Human-friendly display, e.g. "+961 3 123 456". */
export function formatPhone(e164: string | null | undefined): string {
  if (!e164) return "";
  const parsed = parsePhoneNumberFromString(e164);
  return parsed ? parsed.formatInternational() : e164;
}
