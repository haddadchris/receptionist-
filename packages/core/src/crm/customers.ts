/** Customer queries: list with stats, profile, segments. Tenant transaction required. */
import { and, desc, eq, ilike, or, sql, type SQL } from "drizzle-orm";
import type { Tx } from "../db/tenant";
import { appointments, conversations, customers, type Customer, type SegmentDefinition } from "../db/schema";
import { DomainError } from "../lib/errors";

export type CustomerRow = Customer & {
  visits: number;
  upcoming: number;
  lastAppointmentAt: Date | null;
};

/** Fully-qualified outer reference for correlated subqueries (Drizzle renders bare "id"). */
const CID = sql.raw('"customers"."id"');

const stats = {
  visits: sql<number>`(select count(*)::int from ${appointments} a where a.customer_id = ${CID} and a.status = 'completed')`,
  upcoming: sql<number>`(select count(*)::int from ${appointments} a where a.customer_id = ${CID} and a.status in ('pending','confirmed') and a.starts_at >= now())`,
  lastAppointmentAt: sql<Date | null>`(select max(a.starts_at) from ${appointments} a where a.customer_id = ${CID} and a.status in ('completed','no_show') )`,
};

/** SQL conditions for a segment definition (used by CRM filters and campaigns). */
export function segmentConditions(businessId: string, seg: SegmentDefinition & { search?: string }): SQL[] {
  const conds: SQL[] = [eq(customers.businessId, businessId)];
  if (seg.search) {
    const q = `%${seg.search.replace(/[%_]/g, "")}%`;
    conds.push(or(ilike(customers.name, q), ilike(customers.phone, q))!);
  }
  if (seg.tags?.length) {
    conds.push(sql`${customers.tags} && ARRAY[${sql.join(seg.tags.map((t) => sql`${t}`), sql`, `)}]::text[]`);
  }
  if (seg.minNoShows) conds.push(sql`${customers.noShowCount} >= ${seg.minNoShows}`);
  if (seg.noVisitDays) {
    conds.push(
      sql`not exists (select 1 from ${appointments} a where a.customer_id = ${CID} and a.status in ('completed','pending','confirmed') and a.starts_at >= now() - make_interval(days => ${seg.noVisitDays}))`,
    );
    // Only customers who visited at least once before.
    conds.push(sql`exists (select 1 from ${appointments} a where a.customer_id = ${CID} and a.status = 'completed')`);
  }
  if (seg.marketingOptIn) conds.push(sql`${customers.consentMarketing} and ${customers.optedOutAt} is null`);
  if (seg.hasUpcoming === true) conds.push(sql`${stats.upcoming} > 0`);
  if (seg.hasUpcoming === false) conds.push(sql`${stats.upcoming} = 0`);
  if (seg.serviceIds?.length) {
    conds.push(
      sql`exists (select 1 from ${appointments} a where a.customer_id = ${CID} and a.status = 'completed' and a.service_id in (${sql.join(
        seg.serviceIds.map((id) => sql`${id}::uuid`),
        sql`, `,
      )}))`,
    );
  }
  return conds;
}

export async function listCustomers(
  tx: Tx,
  businessId: string,
  opts: SegmentDefinition & { search?: string; limit?: number; offset?: number } = {},
): Promise<CustomerRow[]> {
  const rows = await tx
    .select({ customer: customers, ...stats })
    .from(customers)
    .where(and(...segmentConditions(businessId, opts)))
    .orderBy(desc(customers.updatedAt))
    .limit(opts.limit ?? 100)
    .offset(opts.offset ?? 0);
  return rows.map((r) => ({ ...r.customer, visits: r.visits, upcoming: r.upcoming, lastAppointmentAt: r.lastAppointmentAt ? new Date(r.lastAppointmentAt) : null }));
}

export async function countCustomers(tx: Tx, businessId: string, opts: SegmentDefinition & { search?: string } = {}): Promise<number> {
  const [r] = await tx
    .select({ n: sql<number>`count(*)::int` })
    .from(customers)
    .where(and(...segmentConditions(businessId, opts)));
  return r?.n ?? 0;
}

export async function getCustomer(tx: Tx, businessId: string, id: string): Promise<CustomerRow> {
  const [r] = await tx
    .select({ customer: customers, ...stats })
    .from(customers)
    .where(and(eq(customers.businessId, businessId), eq(customers.id, id)));
  if (!r) throw new DomainError("NOT_FOUND", "Customer not found");
  return { ...r.customer, visits: r.visits, upcoming: r.upcoming, lastAppointmentAt: r.lastAppointmentAt ? new Date(r.lastAppointmentAt) : null };
}

export async function customerConversations(tx: Tx, businessId: string, customerId: string) {
  return tx
    .select()
    .from(conversations)
    .where(and(eq(conversations.businessId, businessId), eq(conversations.customerId, customerId)))
    .orderBy(desc(conversations.lastMessageAt));
}

export async function allTags(tx: Tx, businessId: string): Promise<string[]> {
  const rows = (await tx.execute(
    sql`select distinct unnest(tags) as tag from customers where business_id = ${businessId} order by 1`,
  )) as unknown as { tag: string }[];
  return rows.map((r) => r.tag);
}
