import { describe, expect, it } from "vitest";
import { dictionaries, makeT, negotiate } from "./index";

function leaves(obj: unknown, prefix = ""): string[] {
  if (typeof obj === "string") return [prefix];
  if (Array.isArray(obj)) return [prefix];
  return Object.entries(obj as Record<string, unknown>).flatMap(([k, v]) => leaves(v, prefix ? `${prefix}.${k}` : k));
}

describe("i18n", () => {
  it("every language has every key, with no empty strings", () => {
    const keys = leaves(dictionaries.en).sort();
    for (const l of ["ar", "fr"] as const) {
      expect(leaves(dictionaries[l]).sort()).toEqual(keys);
    }
    for (const l of ["ar", "en", "fr"] as const) {
      const t = makeT(dictionaries[l]);
      for (const k of keys) {
        const v = k.split(".").reduce<unknown>((o, p) => (o as Record<string, unknown>)[p], dictionaries[l]);
        if (typeof v === "string") expect(t(k as never).trim().length, `${l}:${k}`).toBeGreaterThan(0);
      }
    }
  });

  it("interpolates variables", () => {
    expect(makeT(dictionaries.en)("overview.greeting", { name: "Rami" })).toBe("Hello, Rami");
    expect(makeT(dictionaries.ar)("overview.greeting", { name: "رامي" })).toBe("أهلا رامي");
  });

  it("negotiates Accept-Language", () => {
    expect(negotiate("fr-FR,fr;q=0.9,en;q=0.8")).toBe("fr");
    expect(negotiate("ar-LB,ar;q=0.9")).toBe("ar");
    expect(negotiate("de-DE,en;q=0.5")).toBe("en");
    expect(negotiate("de-DE")).toBeNull();
    expect(negotiate("en", ["ar", "fr"])).toBeNull();
  });
});
