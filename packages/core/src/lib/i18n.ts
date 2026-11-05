import type { Locale, LocalizedText } from "../db/schema";

export function pickLocalized(
  text: LocalizedText | null | undefined,
  locale: Locale,
  fallbacks: Locale[] = ["en", "ar", "fr"],
): string {
  if (!text) return "";
  return text[locale] ?? fallbacks.map((l) => text[l]).find(Boolean) ?? "";
}

export function isLocale(v: unknown): v is Locale {
  return v === "ar" || v === "en" || v === "fr";
}

/** Intl locale tags used for formatting. Lebanese Arabic uses Latin digits and Syriac month names (ar-LB). */
export const INTL_LOCALE: Record<Locale, string> = {
  ar: "ar-LB-u-nu-latn",
  en: "en-GB",
  fr: "fr-FR",
};
