/** Owner-facing billing overview: plan, subscription, usage this month, invoices, AI status. */
import { desc, eq } from "drizzle-orm";
import { DateTime } from "luxon";
import { withTenant } from "../db/tenant";
import { invoices, plans, subscriptions, type Business } from "../db/schema";
import { checkAiAllowed, usageSummary, type UsageSummary } from "./limits";
import { hasFeature, TIER_FEATURES, type Feature } from "./features";
import { paymentInstructions } from "../providers/payments";
import { TIER_ORDER } from "./plans";

export type BillingOverview = {
  status: Business["status"];
  tier: Business["planTier"];
  trialDaysLeft: number | null;
  plans: (Omit<typeof plans.$inferSelect, "features"> & { features: Feature[] })[];
  subscription: typeof subscriptions.$inferSelect | null;
  usage: UsageSummary;
  invoices: (typeof invoices.$inferSelect)[];
  openInvoice: typeof invoices.$inferSelect | null;
  aiStatus: { whatsapp: string; voice: string; webChat: string };
  paymentInstructions: string;
};

export async function getBillingOverview(business: Business, now: Date = new Date()): Promise<BillingOverview> {
  const { planRows, sub, invs } = await withTenant(business.id, async (tx) => ({
    planRows: await tx.select().from(plans),
    sub: (await tx.select().from(subscriptions).where(eq(subscriptions.businessId, business.id)))[0] ?? null,
    invs: await tx.select().from(invoices).where(eq(invoices.businessId, business.id)).orderBy(desc(invoices.createdAt)).limit(24),
  }));
  const usage = await usageSummary(business);
  const status = async (f: "whatsappAi" | "voiceAi" | "webChat") => {
    if (!hasFeature(business, f)) return "plan";
    const c = await checkAiAllowed(business, f);
    return c.ok ? "on" : c.reason;
  };
  const trialDaysLeft =
    business.status === "trial" && business.trialEndsAt
      ? Math.max(0, Math.ceil(DateTime.fromJSDate(business.trialEndsAt).diff(DateTime.fromJSDate(now), "days").days))
      : null;
  return {
    status: business.status,
    tier: business.planTier,
    trialDaysLeft,
    plans: planRows
      .sort((a, b) => TIER_ORDER.indexOf(a.tier) - TIER_ORDER.indexOf(b.tier))
      .map((p) => ({ ...p, features: TIER_FEATURES[p.tier] })),
    subscription: sub,
    usage,
    invoices: invs.filter((i) => i.status !== "draft"),
    openInvoice: invs.find((i) => i.status === "issued") ?? null,
    aiStatus: { whatsapp: await status("whatsappAi"), voice: await status("voiceAi"), webChat: await status("webChat") },
    paymentInstructions: paymentInstructions(),
  };
}
