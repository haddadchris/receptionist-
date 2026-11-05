/**
 * Plan usage: included AI messages / voice minutes per month, overage
 * (allowed and billed), and a safety hard cap (USAGE_HARD_CAP_MULTIPLIER × the
 * included amount, default 3×) that pauses AI to prevent runaway costs.
 */
import { eq } from "drizzle-orm";
import { withSystem, withTenant } from "../db/tenant";
import { plans, type Business, type PlanTier } from "../db/schema";
import { usageForPeriod } from "../lib/usage";
import { periodKey } from "../lib/time";
import { aiBlockedReason } from "./features";

export type PlanRow = typeof plans.$inferSelect;

export async function getPlan(tier: PlanTier): Promise<PlanRow | null> {
  const [p] = await withSystem((tx) => tx.select().from(plans).where(eq(plans.tier, tier)));
  return p ?? null;
}

export type UsageSummary = {
  period: string;
  aiMessages: number;
  voiceMinutes: number;
  includedAiMessages: number;
  includedVoiceMinutes: number;
  overageAiMessages: number;
  overageVoiceMinutes: number;
  overageCents: number;
  hardCapReached: { ai: boolean; voice: boolean };
};

const capMultiplier = () => Number(process.env.USAGE_HARD_CAP_MULTIPLIER ?? 3);

export async function usageSummary(business: Business, period = periodKey(business.timezone)): Promise<UsageSummary> {
  const plan = await getPlan(business.planTier);
  const used = await withTenant(business.id, (tx) => usageForPeriod(tx, business.id, period));
  const incAi = plan?.includedAiMessages ?? 0;
  const incVoice = plan?.includedVoiceMinutes ?? 0;
  const overAi = Math.max(0, Math.ceil(used.ai_message) - incAi);
  const overVoice = Math.max(0, Math.ceil(used.voice_minute) - incVoice);
  const mult = capMultiplier();
  return {
    period,
    aiMessages: Math.ceil(used.ai_message),
    voiceMinutes: Math.ceil(used.voice_minute),
    includedAiMessages: incAi,
    includedVoiceMinutes: incVoice,
    overageAiMessages: overAi,
    overageVoiceMinutes: overVoice,
    overageCents: overAi * (plan?.overageAiMessageCents ?? 0) + overVoice * (plan?.overageVoiceMinuteCents ?? 0),
    hardCapReached: {
      ai: mult > 0 && incAi > 0 && used.ai_message >= incAi * mult,
      voice: mult > 0 && incVoice > 0 && used.voice_minute >= incVoice * mult,
    },
  };
}

export type AiCheck = { ok: true } | { ok: false; reason: "plan" | "paused" | "trial_expired" | "usage_cap" };

/** Full gate used by every AI channel before generating a reply / answering a call. */
export async function checkAiAllowed(business: Business, feature: "whatsappAi" | "webChat" | "voiceAi"): Promise<AiCheck> {
  const blocked = aiBlockedReason(business, feature);
  if (blocked) return { ok: false, reason: blocked };
  const u = await usageSummary(business);
  if (feature === "voiceAi" ? u.hardCapReached.voice : u.hardCapReached.ai) return { ok: false, reason: "usage_cap" };
  return { ok: true };
}
