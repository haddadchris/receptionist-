/** Super-admin queries. Must run with `withSuperAdmin`. */
import { desc, eq, sql } from "drizzle-orm";
import type { Tx } from "../db/tenant";
import { businesses, memberships, users } from "../db/schema";
import { periodKey } from "../lib/time";

/** Fully-qualified outer reference for correlated subqueries (Drizzle renders bare "id"). */
const BID = sql.raw('"businesses"."id"');

export type AdminBusinessRow = {
  id: string;
  name: string;
  slug: string;
  vertical: string;
  planTier: "basic" | "standard" | "premium";
  status: "trial" | "active" | "paused" | "cancelled";
  trialEndsAt: Date | null;
  createdAt: Date;
  ownerEmail: string | null;
  bookings30d: number;
  aiMessages: number;
  voiceMinutes: number;
  featureFlags: Record<string, boolean | undefined>;
};

export async function listBusinessesForAdmin(tx: Tx, opts: { search?: string } = {}): Promise<AdminBusinessRow[]> {
  const period = periodKey("Asia/Beirut");
  const rows = await tx
    .select({
      id: businesses.id,
      name: businesses.name,
      slug: businesses.slug,
      vertical: businesses.vertical,
      planTier: businesses.planTier,
      status: businesses.status,
      trialEndsAt: businesses.trialEndsAt,
      createdAt: businesses.createdAt,
      featureFlags: businesses.featureFlags,
      ownerEmail: sql<string | null>`(select u.email from ${memberships} m join ${users} u on u.id = m.user_id where m.business_id = ${BID} and m.role = 'owner' order by m.created_at limit 1)`,
      bookings30d: sql<number>`(select count(*)::int from appointments a where a.business_id = ${BID} and a.created_at >= now() - interval '30 days')`,
      aiMessages: sql<number>`(select coalesce(sum(quantity), 0)::float from usage_events e where e.business_id = ${BID} and e.period = ${period} and e.type = 'ai_message')`,
      voiceMinutes: sql<number>`(select coalesce(sum(quantity), 0)::float from usage_events e where e.business_id = ${BID} and e.period = ${period} and e.type = 'voice_minute')`,
    })
    .from(businesses)
    .where(opts.search ? sql`${businesses.name} ilike ${"%" + opts.search.replace(/[%_]/g, "") + "%"}` : undefined)
    .orderBy(desc(businesses.createdAt));
  return rows;
}

export async function getBusinessForAdmin(tx: Tx, id: string) {
  const [b] = await tx.select().from(businesses).where(eq(businesses.id, id));
  return b ?? null;
}

export async function platformTotals(tx: Tx) {
  const [r] = (await tx.execute(sql`
    select
      (select count(*)::int from businesses) as businesses,
      (select count(*)::int from businesses where status = 'active') as active,
      (select count(*)::int from businesses where status = 'trial') as trials,
      (select count(*)::int from appointments where created_at >= now() - interval '30 days') as bookings30d,
      (select count(*)::int from users) as users
  `)) as unknown as { businesses: number; active: number; trials: number; bookings30d: number; users: number }[];
  return r!;
}
