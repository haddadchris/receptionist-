import "server-only";
import { headers } from "next/headers";
import { cache } from "react";
import { DEFAULT_LOCALE, dictionaries, isLocale, LOCALE_HEADER, makeT, type Locale } from "./index";

/** Locale resolved by proxy.ts (query → cookie → Accept-Language → default). */
export const getLocale = cache(async (): Promise<Locale> => {
  const h = await headers();
  const l = h.get(LOCALE_HEADER);
  return isLocale(l) ? l : DEFAULT_LOCALE;
});

export async function getT(locale?: Locale) {
  const l = locale ?? (await getLocale());
  return { t: makeT(dictionaries[l]), locale: l, dict: dictionaries[l] };
}
