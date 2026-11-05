/**
 * Manual invoicing: generate monthly invoices (subscription + unpaid setup fee
 * + previous month's overage), issue, mark paid with method/reference/receipt,
 * void. Paying activates the business. Super-admin transactions (cross-tenant).
 */
import { and, desc, eq, inArray, like, sql } from "drizzle-orm";
import { DateTime } from "luxon";
import type { Tx } from "../db/tenant";
import { businesses, invoices, payments, plans, subscriptions, type Business, type InvoiceLine } from "../db/schema";
import { usageForPeriod } from "../lib/usage";
import { audit, type Actor } from "../lib/audit";
import { DomainError } from "../lib/errors";
import { formatPrice } from "../lib/time";

export async function nextInvoiceNumber(tx: Tx, year: number): Promise<string> {
  const [r] = await tx
    .select({ n: sql<number>`count(*)::int` })
    .from(invoices)
    .where(like(invoices.number, `FK-${year}-%`));
  return `FK-${year}-${String((r?.n ?? 0) + 1).padStart(4, "0")}`;
}

/** Lines for `period` (YYYY-MM): plan fee for this month, setup fee if unpaid, overage of the previous month. */
export async function buildInvoiceLines(tx: Tx, business: Business, period: string): Promise<InvoiceLine[]> {
  const [plan] = await tx.select().from(plans).where(eq(plans.tier, business.planTier));
  const [sub] = await tx.select().from(subscriptions).where(eq(subscriptions.businessId, business.id));
  if (!plan) throw new DomainError("NOT_FOUND", "Plan not found");
  const lines: InvoiceLine[] = [];
  const monthly = sub?.monthlyFeeCents ?? plan.monthlyFeeCents;
  lines.push({ description: `${plan.name} — ${period}`, quantity: 1, unitCents: monthly, totalCents: monthly });
  if (sub && !sub.setupFeePaid && sub.setupFeeCents > 0) {
    lines.push({ description: "One-time setup fee", quantity: 1, unitCents: sub.setupFeeCents, totalCents: sub.setupFeeCents });
  }
  const prev = DateTime.fromFormat(period, "yyyy-MM").minus({ months: 1 }).toFormat("yyyy-MM");
  const used = await usageForPeriod(tx, business.id, prev);
  const overAi = Math.max(0, Math.ceil(used.ai_message) - plan.includedAiMessages);
  const overVoice = Math.max(0, Math.ceil(used.voice_minute) - plan.includedVoiceMinutes);
  if (overAi && plan.overageAiMessageCents) {
    lines.push({ description: `AI messages over plan (${prev}): ${overAi} × ${formatPrice(plan.overageAiMessageCents)}`, quantity: overAi, unitCents: plan.overageAiMessageCents, totalCents: overAi * plan.overageAiMessageCents });
  }
  if (overVoice && plan.overageVoiceMinuteCents) {
    lines.push({ description: `Voice minutes over plan (${prev}): ${overVoice} × ${formatPrice(plan.overageVoiceMinuteCents)}`, quantity: overVoice, unitCents: plan.overageVoiceMinuteCents, totalCents: overVoice * plan.overageVoiceMinuteCents });
  }
  return lines;
}

export async function createInvoice(
  tx: Tx,
  input: { businessId: string; period: string; lines?: InvoiceLine[]; issue?: boolean; dueDays?: number; notes?: string | null; actor: Actor },
) {
  const [business] = await tx.select().from(businesses).where(eq(businesses.id, input.businessId));
  if (!business) throw new DomainError("NOT_FOUND", "Business not found");
  const lines = input.lines ?? (await buildInvoiceLines(tx, business, input.period));
  const total = lines.reduce((s, l) => s + l.totalCents, 0);
  const start = DateTime.fromFormat(input.period, "yyyy-MM", { zone: business.timezone }).startOf("month");
  const now = new Date();
  const [inv] = await tx
    .insert(invoices)
    .values({
      businessId: business.id,
      number: await nextInvoiceNumber(tx, start.year),
      status: input.issue === false ? "draft" : "issued",
      periodStart: start.toJSDate(),
      periodEnd: start.endOf("month").toJSDate(),
      lines,
      totalCents: total,
      issuedAt: input.issue === false ? null : now,
      dueAt: DateTime.fromJSDate(now).plus({ days: input.dueDays ?? 7 }).toJSDate(),
      notes: input.notes ?? null,
    })
    .returning();
  await audit(tx, { businessId: business.id, actor: input.actor, action: "invoice.created", entityType: "invoice", entityId: inv!.id, changes: { number: inv!.number, total } });
  return inv!;
}

/** Generate `period` invoices for businesses (default: active) that don't have one for that period yet. */
export async function generateMonthlyInvoices(
  tx: Tx,
  period: string,
  actor: Actor,
  opts: { statuses?: ("trial" | "active" | "paused")[]; businessIds?: string[] } = {},
) {
  const rows = await tx
    .select()
    .from(businesses)
    .where(and(inArray(businesses.status, opts.statuses ?? ["active"]), opts.businessIds?.length ? inArray(businesses.id, opts.businessIds) : undefined));
  const created = [];
  for (const b of rows) {
    const start = DateTime.fromFormat(period, "yyyy-MM", { zone: b.timezone }).startOf("month").toJSDate();
    const [existing] = await tx.select({ id: invoices.id }).from(invoices).where(and(eq(invoices.businessId, b.id), eq(invoices.periodStart, start)));
    if (existing) continue;
    created.push(await createInvoice(tx, { businessId: b.id, period, actor }));
  }
  return created;
}

export async function markInvoicePaid(
  tx: Tx,
  input: { invoiceId: string; method: "cash" | "bank_transfer" | "wallet" | "card" | "other"; reference?: string | null; receiptUrl?: string | null; actor: Actor },
) {
  const [inv] = await tx.select().from(invoices).where(eq(invoices.id, input.invoiceId));
  if (!inv) throw new DomainError("NOT_FOUND", "Invoice not found");
  if (inv.status === "void") throw new DomainError("CONFLICT", "Invoice is void");
  if (inv.status === "paid") return inv;
  const now = new Date();
  const [paid] = await tx
    .update(invoices)
    .set({ status: "paid", paidAt: now, paymentMethod: input.method, paymentReference: input.reference ?? null, receiptUrl: input.receiptUrl ?? inv.receiptUrl })
    .where(eq(invoices.id, inv.id))
    .returning();
  await tx.insert(payments).values({
    businessId: inv.businessId,
    invoiceId: inv.id,
    kind: "subscription",
    amountCents: inv.totalCents,
    method: input.method,
    provider: "manual",
    providerRef: input.reference ?? null,
    status: "succeeded",
  });
  // Paying activates the account (AI resumes) for the invoiced period.
  const hasSetup = inv.lines.some((l) => /setup/i.test(l.description));
  await tx
    .update(subscriptions)
    .set({ status: "active", currentPeriodStart: inv.periodStart, currentPeriodEnd: inv.periodEnd, ...(hasSetup ? { setupFeePaid: true } : {}) })
    .where(eq(subscriptions.businessId, inv.businessId));
  await tx.update(businesses).set({ status: "active" }).where(and(eq(businesses.id, inv.businessId), inArray(businesses.status, ["trial", "paused"])));
  await audit(tx, { businessId: inv.businessId, actor: input.actor, action: "invoice.paid", entityType: "invoice", entityId: inv.id, changes: { method: input.method, reference: input.reference } });
  return paid!;
}

export async function voidInvoice(tx: Tx, invoiceId: string, actor: Actor) {
  const [inv] = await tx.update(invoices).set({ status: "void" }).where(and(eq(invoices.id, invoiceId), inArray(invoices.status, ["draft", "issued"]))).returning();
  if (!inv) throw new DomainError("CONFLICT", "Only draft/issued invoices can be voided");
  await audit(tx, { businessId: inv.businessId, actor, action: "invoice.voided", entityType: "invoice", entityId: inv.id });
  return inv;
}

export async function listInvoices(tx: Tx, opts: { businessId?: string; status?: string } = {}) {
  return tx
    .select({ invoice: invoices, businessName: businesses.name })
    .from(invoices)
    .innerJoin(businesses, eq(businesses.id, invoices.businessId))
    .where(and(opts.businessId ? eq(invoices.businessId, opts.businessId) : undefined, opts.status ? eq(invoices.status, opts.status as never) : undefined))
    .orderBy(desc(invoices.createdAt))
    .limit(300);
}

/**
 * Daily billing sweep: pause AI for businesses whose invoice is >7 days overdue
 * (the booking page keeps working). Trials pause automatically via trialEndsAt.
 */
export async function pauseOverdueBusinesses(tx: Tx, graceDays = Number(process.env.BILLING_GRACE_DAYS ?? 7)) {
  const cutoff = DateTime.now().minus({ days: graceDays }).toJSDate();
  const overdue = await tx
    .select({ businessId: invoices.businessId })
    .from(invoices)
    .where(and(eq(invoices.status, "issued"), sql`${invoices.dueAt} < ${cutoff.toISOString()}::timestamptz`));
  const ids = [...new Set(overdue.map((o) => o.businessId))];
  if (!ids.length) return 0;
  const paused = await tx.update(businesses).set({ status: "paused" }).where(and(inArray(businesses.id, ids), eq(businesses.status, "active"))).returning({ id: businesses.id });
  for (const p of paused) await audit(tx, { businessId: p.id, actor: { type: "system", label: "billing" }, action: "business.paused_overdue", entityType: "business", entityId: p.id });
  return paused.length;
}
