/**
 * Sales leads ("Book a demo" form → admin pipeline). Leads are platform data:
 * RLS lets only super admins read/write them; the public form inserts through
 * the system connection after validation and rate limiting.
 */
import { and, desc, eq, gte, sql } from "drizzle-orm";
import { z } from "zod";
import type { Tx } from "../db/tenant";
import { leads } from "../db/schema";
import { normalizePhone } from "../lib/phone";
import { audit, type Actor } from "../lib/audit";
import { DomainError } from "../lib/errors";

export const LEAD_STAGES = ["new", "demo_scheduled", "demo_done", "trial", "paying", "lost"] as const;
export type LeadStage = (typeof LEAD_STAGES)[number];

export const leadInputSchema = z.object({
  name: z.string().trim().min(2).max(80),
  businessName: z.string().trim().max(120).optional().or(z.literal("")),
  phone: z.string().trim().min(6).max(30),
  email: z.string().trim().email().max(120).optional().or(z.literal("")),
  vertical: z.string().trim().max(40).optional().or(z.literal("")),
  city: z.string().trim().max(60).optional().or(z.literal("")),
  message: z.string().trim().max(1000).optional().or(z.literal("")),
  plan: z.enum(["basic", "standard", "premium"]).optional(),
  language: z.enum(["ar", "en", "fr"]).optional(),
  source: z.string().trim().max(60).optional(),
});

export async function createLead(tx: Tx, input: z.input<typeof leadInputSchema>) {
  const p = leadInputSchema.parse(input);
  const phone = normalizePhone(p.phone);
  if (!phone) throw new DomainError("VALIDATION", "Invalid phone number", { field: "phone" });
  // Same phone within 24 h → update the existing lead instead of duplicating it.
  const [recent] = await tx
    .select()
    .from(leads)
    .where(and(eq(leads.phone, phone), gte(leads.createdAt, sql`now() - interval '24 hours'`)))
    .limit(1);
  const extra = [p.plan ? `Interested in: ${p.plan}` : null, p.language ? `Language: ${p.language}` : null].filter(Boolean).join(" · ");
  const message = [p.message || null, extra || null].filter(Boolean).join("\n") || null;
  if (recent) {
    const [row] = await tx
      .update(leads)
      .set({ message: [recent.message, message].filter(Boolean).join("\n---\n") || null, businessName: recent.businessName ?? (p.businessName || null) })
      .where(eq(leads.id, recent.id))
      .returning();
    return { lead: row!, duplicate: true };
  }
  const [row] = await tx
    .insert(leads)
    .values({
      name: p.name,
      businessName: p.businessName || null,
      phone,
      email: p.email || null,
      vertical: p.vertical || null,
      city: p.city || null,
      message,
      source: p.source ?? "website",
      stage: "new",
    })
    .returning();
  await audit(tx, { businessId: null, actor: { type: "customer", label: p.name }, action: "lead.created", entityType: "lead", entityId: row!.id, changes: { source: row!.source } });
  return { lead: row!, duplicate: false };
}

export async function listLeads(tx: Tx) {
  return tx.select().from(leads).orderBy(desc(leads.createdAt)).limit(500);
}

export async function updateLead(tx: Tx, id: string, input: { stage?: LeadStage; note?: string; businessId?: string | null }, actor: Actor) {
  const p = z
    .object({ stage: z.enum(LEAD_STAGES).optional(), note: z.string().trim().max(1000).optional(), businessId: z.string().uuid().nullish() })
    .parse(input);
  const [current] = await tx.select().from(leads).where(eq(leads.id, id));
  if (!current) throw new DomainError("NOT_FOUND", "Lead not found");
  const stamp = new Date().toISOString().slice(0, 16).replace("T", " ");
  const notes = p.note ? `${current.notes ? `${current.notes}\n` : ""}[${stamp}${actor.label ? ` · ${actor.label}` : ""}] ${p.note}` : current.notes;
  const [row] = await tx
    .update(leads)
    .set({ ...(p.stage ? { stage: p.stage } : {}), notes, ...(p.businessId !== undefined ? { businessId: p.businessId } : {}) })
    .where(eq(leads.id, id))
    .returning();
  await audit(tx, { businessId: null, actor, action: "lead.updated", entityType: "lead", entityId: id, changes: { stage: p.stage, note: !!p.note } });
  return row!;
}

export async function leadCounts(tx: Tx) {
  const rows = await tx.select({ stage: leads.stage, n: sql<number>`count(*)::int` }).from(leads).groupBy(leads.stage);
  return Object.fromEntries(LEAD_STAGES.map((s) => [s, rows.find((r) => r.stage === s)?.n ?? 0])) as Record<LeadStage, number>;
}
