/**
 * Plans (pricing is configurable by the super admin) and plan changes.
 *  - During the trial an owner can switch tiers freely (try before you buy).
 *  - On an active subscription an owner *requests* a change; an admin approves it.
 */
import { asc, eq } from "drizzle-orm";
import { z } from "zod";
import type { Tx } from "../db/tenant";
import { businesses, plans, subscriptions, type PlanTier } from "../db/schema";
import { audit, type Actor } from "../lib/audit";
import { DomainError } from "../lib/errors";

export const TIER_ORDER: PlanTier[] = ["basic", "standard", "premium"];

export async function listPlans(tx: Tx) {
  const rows = await tx.select().from(plans).orderBy(asc(plans.monthlyFeeCents));
  return rows.sort((a, b) => TIER_ORDER.indexOf(a.tier) - TIER_ORDER.indexOf(b.tier));
}

export const planUpdateSchema = z.object({
  tier: z.enum(["basic", "standard", "premium"]),
  name: z.string().trim().min(2).max(60),
  setupFeeCents: z.number().int().min(0).max(10_000_000),
  monthlyFeeCents: z.number().int().min(0).max(10_000_000),
  includedAiMessages: z.number().int().min(0).max(10_000_000),
  includedVoiceMinutes: z.number().int().min(0).max(10_000_000),
  overageAiMessageCents: z.number().int().min(0).max(100_000),
  overageVoiceMinuteCents: z.number().int().min(0).max(100_000),
});

/** Super-admin only (RLS: plans are writable by super admins). Existing subscriptions keep their fees until changed. */
export async function updatePlan(tx: Tx, input: z.infer<typeof planUpdateSchema>, actor: Actor) {
  const p = planUpdateSchema.parse(input);
  const [row] = await tx
    .update(plans)
    .set({
      name: p.name,
      setupFeeCents: p.setupFeeCents,
      monthlyFeeCents: p.monthlyFeeCents,
      includedAiMessages: p.includedAiMessages,
      includedVoiceMinutes: p.includedVoiceMinutes,
      overageAiMessageCents: p.overageAiMessageCents,
      overageVoiceMinuteCents: p.overageVoiceMinuteCents,
    })
    .where(eq(plans.tier, p.tier))
    .returning();
  if (!row) throw new DomainError("NOT_FOUND", "Plan not found");
  await audit(tx, { businessId: null, actor, action: "plan.updated", entityType: "plan", entityId: null, changes: p });
  return row;
}

/**
 * Apply a plan to a business: tier + subscription fees from the current price list.
 * `keepFees` keeps a negotiated price (admin can still edit fees separately).
 * Must run in a super-admin or system transaction.
 */
export async function applyPlanChange(tx: Tx, businessId: string, tier: PlanTier, actor: Actor, opts: { keepFees?: boolean } = {}) {
  const [plan] = await tx.select().from(plans).where(eq(plans.tier, tier));
  if (!plan) throw new DomainError("NOT_FOUND", "Plan not found");
  await tx.update(businesses).set({ planTier: tier }).where(eq(businesses.id, businessId));
  await tx
    .update(subscriptions)
    .set({
      planTier: tier,
      pendingPlanTier: null,
      ...(opts.keepFees ? {} : { monthlyFeeCents: plan.monthlyFeeCents, setupFeeCents: plan.setupFeeCents }),
    })
    .where(eq(subscriptions.businessId, businessId));
  await audit(tx, { businessId, actor, action: "plan.changed", entityType: "business", entityId: businessId, changes: { tier } });
}

/** Owner request. Trials switch immediately; active subscriptions wait for admin approval. Runs as system. */
export async function requestPlanChange(tx: Tx, businessId: string, tier: PlanTier, actor: Actor): Promise<"applied" | "requested" | "unchanged"> {
  const [b] = await tx.select().from(businesses).where(eq(businesses.id, businessId));
  if (!b) throw new DomainError("NOT_FOUND", "Business not found");
  if (b.planTier === tier) {
    await tx.update(subscriptions).set({ pendingPlanTier: null }).where(eq(subscriptions.businessId, businessId));
    return "unchanged";
  }
  if (b.status === "trial") {
    await applyPlanChange(tx, businessId, tier, actor);
    return "applied";
  }
  await tx.update(subscriptions).set({ pendingPlanTier: tier }).where(eq(subscriptions.businessId, businessId));
  await audit(tx, { businessId, actor, action: "plan.change_requested", entityType: "business", entityId: businessId, changes: { from: b.planTier, to: tier } });
  return "requested";
}

export async function updateSubscriptionFees(tx: Tx, businessId: string, fees: { setupFeeCents?: number; monthlyFeeCents?: number; setupFeePaid?: boolean }, actor: Actor) {
  const p = z
    .object({ setupFeeCents: z.number().int().min(0).optional(), monthlyFeeCents: z.number().int().min(0).optional(), setupFeePaid: z.boolean().optional() })
    .parse(fees);
  await tx.update(subscriptions).set(p).where(eq(subscriptions.businessId, businessId));
  await audit(tx, { businessId, actor, action: "subscription.fees_updated", entityType: "business", entityId: businessId, changes: p });
}
