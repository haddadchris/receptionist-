import "server-only";
import { and, eq, sql } from "drizzle-orm";
import { withTenant } from "@fekerte/core/db/tenant";
import { conversations, type Business } from "@fekerte/core/db/schema";
import type { NavFeature } from "@/components/layout/dashboard-nav";
import { hasFeature } from "@fekerte/core/billing/features";

/** Dashboard sections that exist in this build (grows phase by phase). */
const BUILT: Set<NavFeature> = new Set<NavFeature>(["inbox", "ai", "calls"]);

/** Which optional dashboard sections are visible for this business's plan. */
export function enabledNavFeatures(business: Business): NavFeature[] {
  return allowedNavFeatures(business).filter((f) => BUILT.has(f));
}

function allowedNavFeatures(business: Business): NavFeature[] {
  const out: NavFeature[] = ["analytics", "billing"];
  if (hasFeature(business, "whatsappAi") || hasFeature(business, "webChat")) out.push("inbox", "ai");
  if (hasFeature(business, "voiceAi")) out.push("calls");
  if (hasFeature(business, "campaigns")) out.push("campaigns");
  return out;
}

export async function unreadCount(businessId: string): Promise<number> {
  const [row] = await withTenant(businessId, (tx) =>
    tx
      .select({ n: sql<number>`coalesce(sum(${conversations.unreadCount}), 0)::int` })
      .from(conversations)
      .where(and(eq(conversations.businessId, businessId))),
  );
  return row?.n ?? 0;
}
