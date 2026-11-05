"use client";

import { createContext, useContext, useMemo } from "react";
import { dictionaries, makeT, type Locale, type TFn } from "./index";

const I18nContext = createContext<{ locale: Locale; t: TFn }>({ locale: "ar", t: makeT(dictionaries.ar) });

export function I18nProvider({ locale, children }: { locale: Locale; children: React.ReactNode }) {
  const value = useMemo(() => ({ locale, t: makeT(dictionaries[locale]) }), [locale]);
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n() {
  return useContext(I18nContext);
}

export function useT(): TFn {
  return useContext(I18nContext).t;
}
