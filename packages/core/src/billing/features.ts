/**
 * Plan feature gating. Tier defaults can be overridden per business with
 * `businesses.feature_flags` (toggled from the super-admin panel).
 */
import type { Business, FeatureFlags, PlanTier } from "../db/schema";

export type Feature = Exclude<keyof FeatureFlags, number>;

const BASIC: Feature[] = ["deposits"];
const STANDARD: Feature[] = [...BASIC, "whatsappAi", "webChat", "reviews", "recalls", "campaigns"];
const PREMIUM: Feature[] = [...STANDARD, "voiceAi"];

export const TIER_FEATURES: Record<PlanTier, Feature[]> = { basic: BASIC, standard: STANDARD, premium: PREMIUM };

export const ALL_FEATURES: Feature[] = ["whatsappAi", "webChat", "voiceAi", "deposits", "reviews", "recalls", "campaigns"];

export function hasFeature(business: Pick<Business, "planTier" | "featureFlags">, feature: Feature): boolean {
  const override = business.featureFlags?.[feature];
  if (typeof override === "boolean") return override;
  return TIER_FEATURES[business.planTier].includes(feature);
}

/**
 * Why AI features are unavailable right now, or null if allowed.
 * The booking page keeps working regardless (Phase 4 adds usage limits).
 */
export function aiBlockedReason(
  business: Pick<Business, "planTier" | "featureFlags" | "status" | "trialEndsAt">,
  feature: "whatsappAi" | "voiceAi" | "webChat",
  now: Date = new Date(),
): "plan" | "paused" | "trial_expired" | null {
  if (!hasFeature(business, feature)) return "plan";
  if (business.status === "paused" || business.status === "cancelled") return "paused";
  if (business.status === "trial" && business.trialEndsAt && business.trialEndsAt < now) return "trial_expired";
  return null;
}
