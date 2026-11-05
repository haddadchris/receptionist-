import { describe, expect, it } from "vitest";
import { normalizePhone } from "../../src/lib/phone";
import { renderTemplate, TEMPLATES } from "../../src/notifications/templates";
import { signManageToken, verifyManageToken } from "../../src/booking/tokens";
import { formatDateTime, formatPrice } from "../../src/lib/time";
import { slugify, isValidSlug } from "../../src/business/setup";

describe("normalizePhone (Lebanon default)", () => {
  it.each([
    ["03 123 456", "+9613123456"],
    ["03-123456", "+9613123456"],
    ["70 123 456", "+96170123456"],
    ["+961 70 123 456", "+96170123456"],
    ["0096170123456", "+96170123456"],
    ["96170123456", "+96170123456"],
    ["٠٣١٢٣٤٥٦", "+9613123456"],
    ["09 540 123", "+9619540123"],
    ["+33 6 12 34 56 78", "+33612345678"],
  ])("%s → %s", (input, expected) => {
    expect(normalizePhone(input)).toBe(expected);
  });
  it("rejects garbage", () => {
    expect(normalizePhone("12")).toBeNull();
    expect(normalizePhone("")).toBeNull();
    expect(normalizePhone("hello")).toBeNull();
  });
});

describe("templates", () => {
  it("renders every template in every language with all variables", () => {
    for (const def of Object.values(TEMPLATES)) {
      for (const locale of ["ar", "en", "fr"] as const) {
        const vars = def.variables.map((_, i) => `V${i + 1}`);
        const out = renderTemplate(def.name, locale, vars);
        expect(out).not.toMatch(/\{\{\d+\}\}/);
        for (const v of vars) expect(out).toContain(v);
      }
    }
  });
});

describe("manage tokens", () => {
  it("round-trips and rejects tampering", () => {
    const id = "3d85a610-1e67-4995-b9ac-d79c25b263cd";
    const token = signManageToken(id);
    expect(verifyManageToken(token)).toBe(id);
    expect(verifyManageToken(token.slice(0, -2) + "xx")).toBeNull();
    const other = signManageToken("00000000-0000-0000-0000-000000000000");
    expect(verifyManageToken(`${token.split(".")[0]}.${other.split(".")[1]}`)).toBeNull();
    expect(verifyManageToken("garbage")).toBeNull();
  });
});

describe("formatting", () => {
  it("uses Lebanese Arabic month names with Latin digits", () => {
    const s = formatDateTime("2026-11-10T14:30:00Z", "Asia/Beirut", "ar");
    expect(s).toContain("تشرين الثاني");
    expect(s).toMatch(/10/);
    expect(s).toMatch(/4:30/);
  });
  it("formats English and French", () => {
    expect(formatDateTime("2026-11-10T14:30:00Z", "Asia/Beirut", "en")).toMatch(/Tuesday.*10 November.*4:30/);
    expect(formatDateTime("2026-11-10T14:30:00Z", "Asia/Beirut", "fr")).toMatch(/mardi.*10 novembre.*16:30/);
  });
  it("formats prices", () => {
    expect(formatPrice(4000)).toBe("$40");
    expect(formatPrice(8050)).toBe("$80.50");
    expect(formatPrice(8000, { from: true, locale: "en" })).toBe("from $80");
    expect(formatPrice(null)).toBe("");
  });
});

describe("slugs", () => {
  it("slugifies names", () => {
    expect(slugify("Demo Dental Clinic")).toBe("demo-dental-clinic");
    expect(slugify("Café Épilation")).toBe("cafe-epilation");
    expect(isValidSlug("demo-dental")).toBe(true);
    expect(isValidSlug("admin")).toBe(false);
    expect(isValidSlug("-bad")).toBe(false);
  });
});
