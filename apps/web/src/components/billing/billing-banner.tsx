import Link from "next/link";
import { DateTime } from "luxon";
import type { Business } from "@fekerte/core/db/schema";
import { usageSummary } from "@fekerte/core/billing/limits";
import { hasFeature } from "@fekerte/core/billing/features";
import { getT } from "@/i18n/server";

/** Dashboard-wide notice: trial ending soon, AI paused for billing, or usage cap reached. */
export async function BillingBanner({ business, isOwner }: { business: Business; isOwner: boolean }) {
  const { t } = await getT();
  let message: string | null = null;
  let tone: "info" | "warn" = "info";
  if (business.status === "paused") {
    message = t("billing.pausedBanner");
    tone = "warn";
  } else if (business.status === "trial" && business.trialEndsAt) {
    const days = Math.max(0, Math.ceil(DateTime.fromJSDate(business.trialEndsAt).diff(DateTime.now(), "days").days));
    if (days <= 0) {
      message = t("billing.pausedBanner");
      tone = "warn";
    } else if (days <= 5) message = t("billing.trialBanner", { days });
  }
  if (!message && (hasFeature(business, "whatsappAi") || hasFeature(business, "voiceAi"))) {
    const u = await usageSummary(business);
    if (u.hardCapReached.ai || u.hardCapReached.voice) {
      message = t("billing.capBanner");
      tone = "warn";
    }
  }
  if (!message) return null;
  return (
    <div className={`flex flex-wrap items-center justify-center gap-x-3 gap-y-1 px-4 py-2 text-center text-sm print:hidden ${tone === "warn" ? "bg-warning/20" : "bg-primary/10"}`} data-testid="billing-banner">
      <span>{message}</span>
      {isOwner ? (
        <Link href="/dashboard/billing" className="font-medium underline">
          {t("billing.seeBilling")}
        </Link>
      ) : null}
    </div>
  );
}
