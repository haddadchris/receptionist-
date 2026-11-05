import { afterAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { withSuperAdmin, withSystem, withTenant } from "../../src/db/tenant";
import { closeDb } from "../../src/db/client";
import { leads } from "../../src/db/schema";
import { createLead, leadCounts, listLeads, updateLead } from "../../src/sales/leads";
import { createTestBusiness, dbAvailable } from "../fixtures";

describe.skipIf(!dbAvailable())("sales leads", () => {
  afterAll(() => closeDb());
  const phone = `71 ${String(Date.now()).slice(-6)}`;

  it("creates a lead with a normalized phone and merges repeats within 24h", async () => {
    const a = await withSystem((tx) => createLead(tx, { name: "Dr. Lina", businessName: "Smile Clinic", phone, vertical: "dental", city: "Zahle", plan: "premium", language: "ar" }));
    expect(a.duplicate).toBe(false);
    expect(a.lead.phone).toMatch(/^\+96171\d{6}$/);
    expect(a.lead.stage).toBe("new");
    expect(a.lead.message).toContain("Interested in: premium");
    const b = await withSystem((tx) => createLead(tx, { name: "Dr. Lina", phone, message: "Prefer afternoons" }));
    expect(b.duplicate).toBe(true);
    expect(b.lead.id).toBe(a.lead.id);
    expect(b.lead.message).toContain("Prefer afternoons");
  });

  it("rejects invalid input", async () => {
    await expect(withSystem((tx) => createLead(tx, { name: "X", phone: "123" }))).rejects.toThrow();
    await expect(withSystem((tx) => createLead(tx, { name: "Valid Name", phone: "not a phone" }))).rejects.toThrow(/phone/i);
  });

  it("moves through the pipeline with timestamped notes", async () => {
    const [lead] = await withSuperAdmin((tx) => listLeads(tx));
    const { owner } = await createTestBusiness({ name: "Lead Admin" });
    const actor = { type: "user", userId: owner.id, label: "admin@test" } as const;
    await withSuperAdmin((tx) => updateLead(tx, lead!.id, { stage: "demo_scheduled", note: "Demo Tue 3pm" }, actor));
    const updated = await withSuperAdmin((tx) => updateLead(tx, lead!.id, { note: "Sent pricing" }, actor));
    expect(updated.stage).toBe("demo_scheduled");
    expect(updated.notes).toMatch(/admin@test\] Demo Tue 3pm\n.*Sent pricing/);
    const counts = await withSuperAdmin((tx) => leadCounts(tx));
    expect(counts.demo_scheduled).toBeGreaterThanOrEqual(1);
  });

  it("RLS: tenants can never read leads", async () => {
    const t = await createTestBusiness({ name: "Curious Clinic" });
    const rows = await withTenant(t.businessId, (tx) => tx.select().from(leads));
    expect(rows).toHaveLength(0);
    const [any] = await withSystem((tx) => tx.select().from(leads).limit(1));
    const upd = await withTenant(t.businessId, (tx) => tx.update(leads).set({ stage: "lost" }).where(eq(leads.id, any!.id)).returning());
    expect(upd).toHaveLength(0);
  });
});
