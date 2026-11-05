import { en, type Dict } from "./en";
import { ar } from "./ar";
import { fr } from "./fr";

export type Locale = "ar" | "en" | "fr";
export const LOCALES: Locale[] = ["ar", "en", "fr"];
export const DEFAULT_LOCALE: Locale = "ar";
export const LOCALE_COOKIE = "fk_locale";
export const LOCALE_HEADER = "x-fk-locale";

export const dictionaries: Record<Locale, Dict> = { en, ar, fr };

export const isLocale = (v: unknown): v is Locale => v === "ar" || v === "en" || v === "fr";
export const dirOf = (l: Locale) => (l === "ar" ? "rtl" : "ltr");

/** Dot-paths to string leaves of the dictionary. */
type Leaves<T, P extends string = ""> = {
  [K in keyof T & string]: T[K] extends string ? `${P}${K}` : T[K] extends readonly unknown[] ? never : Leaves<T[K], `${P}${K}.`>;
}[keyof T & string];

export type TKey = Leaves<Dict>;
export type TFn = (key: TKey, vars?: Record<string, string | number>) => string;

export function makeT(dict: Dict): TFn {
  return (key, vars) => {
    let cur: unknown = dict;
    for (const part of key.split(".")) cur = (cur as Record<string, unknown> | undefined)?.[part];
    let s = typeof cur === "string" ? cur : key;
    if (vars) for (const [k, v] of Object.entries(vars)) s = s.replaceAll(`{${k}}`, String(v));
    return s;
  };
}

/** Pick the best supported locale from an Accept-Language header. */
export function negotiate(acceptLanguage: string | null | undefined, allowed: Locale[] = LOCALES): Locale | null {
  if (!acceptLanguage) return null;
  const prefs = acceptLanguage
    .split(",")
    .map((part) => {
      const [tag = "", q] = part.trim().split(";q=");
      return { lang: tag.toLowerCase().slice(0, 2), q: q ? Number(q) : 1 };
    })
    .sort((a, b) => b.q - a.q);
  for (const p of prefs) if (isLocale(p.lang) && allowed.includes(p.lang)) return p.lang;
  return null;
}

export type { Dict };
