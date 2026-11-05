/**
 * Owner analytics ("proof of ROI") for a date range, all tenant-scoped:
 * bookings by source, revenue estimate, no-show rate, busiest hours,
 * AI-handled vs human conversations, conversation → booking conversion,
 * calls answered vs missed, reviews, recalls, deposits.
 */
import { sql } from "drizzle-orm";
import type { Tx } from "../db/tenant";

const AI_SOURCES = sql`('whatsapp','web_chat','voice')`;
const ANSWERED = sql`('booked','rescheduled','cancelled','info','transferred','message_taken')`;

export type Analytics = Awaited<ReturnType<typeof getAnalytics>>;

const num = (v: unknown) => Number(v ?? 0);

export async function getAnalytics(tx: Tx, businessId: string, range: { from: Date; to: Date; timezone: string }) {
  const from = range.from.toISOString();
  const to = range.to.toISOString();
  const tz = range.timezone;
  const rows = async <T>(q: ReturnType<typeof sql>) => (await tx.execute(q)) as unknown as T[];

  const bySource = await rows<{ source: string; n: number; cents: number }>(sql`
    select source, count(*)::int n, coalesce(sum(price_cents) filter (where status <> 'cancelled'), 0)::int cents
    from appointments where business_id = ${businessId} and created_at >= ${from} and created_at < ${to}
    group by source order by n desc`);

  const [outcomes] = await rows<{ completed: number; no_show: number; cancelled: number; upcoming: number; completed_cents: number; booked_cents: number }>(sql`
    select count(*) filter (where status = 'completed')::int completed,
           count(*) filter (where status = 'no_show')::int no_show,
           count(*) filter (where status = 'cancelled')::int cancelled,
           count(*) filter (where status in ('pending','confirmed'))::int upcoming,
           coalesce(sum(price_cents) filter (where status = 'completed'), 0)::int completed_cents,
           coalesce(sum(price_cents) filter (where status <> 'cancelled' and status <> 'no_show'), 0)::int booked_cents
    from appointments where business_id = ${businessId} and starts_at >= ${from} and starts_at < ${to}`);

  const [ai] = await rows<{ n: number; cents: number; after_hours: number }>(sql`
    select count(*)::int n, coalesce(sum(price_cents), 0)::int cents,
           count(*) filter (where extract(hour from created_at at time zone ${tz}) >= 19 or extract(hour from created_at at time zone ${tz}) < 8)::int after_hours
    from appointments where business_id = ${businessId} and created_at >= ${from} and created_at < ${to}
      and source in ${AI_SOURCES} and status <> 'cancelled'`);

  const busiest = await rows<{ dow: number; hr: number; n: number }>(sql`
    select extract(isodow from starts_at at time zone ${tz})::int as dow, extract(hour from starts_at at time zone ${tz})::int as hr, count(*)::int as n
    from appointments where business_id = ${businessId} and starts_at >= ${from} and starts_at < ${to} and status <> 'cancelled'
    group by 1, 2`);

  const daily = await rows<{ day: string; n: number; ai: number }>(sql`
    select to_char(created_at at time zone ${tz}, 'YYYY-MM-DD') as day, count(*)::int n, count(*) filter (where source in ${AI_SOURCES})::int ai
    from appointments where business_id = ${businessId} and created_at >= ${from} and created_at < ${to}
    group by 1 order by 1`);

  const [convos] = await rows<{ total: number; human: number; converted: number }>(sql`
    with c as (
      select cv.id, cv.status,
        exists (select 1 from messages m where m.conversation_id = cv.id and m.sender = 'staff' and m.created_at >= ${from} and m.created_at < ${to}) as staff_replied,
        exists (select 1 from appointments a where a.conversation_id = cv.id and a.created_at >= ${from} and a.created_at < ${to}) as booked
      from conversations cv
      where cv.business_id = ${businessId} and cv.channel in ('whatsapp','web_chat')
        and exists (select 1 from messages m where m.conversation_id = cv.id and m.direction = 'inbound' and m.sender = 'customer' and m.created_at >= ${from} and m.created_at < ${to})
    )
    select count(*)::int total,
           count(*) filter (where staff_replied or status = 'human_takeover')::int human,
           count(*) filter (where booked)::int converted
    from c`);

  const [callStats] = await rows<{ total: number; answered: number; booked: number; transferred: number; minutes: number }>(sql`
    select count(*)::int total,
           count(*) filter (where outcome in ${ANSWERED})::int answered,
           count(*) filter (where outcome = 'booked')::int booked,
           count(*) filter (where outcome = 'transferred')::int transferred,
           coalesce(round(sum(duration_seconds) / 60.0), 0)::int minutes
    from calls where business_id = ${businessId} and started_at >= ${from} and started_at < ${to} and provider <> 'browser'`);

  const [reviews] = await rows<{ n: number; avg: number | null; positive: number; negative: number; requested: number }>(sql`
    select count(*) filter (where rating is not null)::int n, round(avg(rating)::numeric, 1)::float avg,
           count(*) filter (where rating >= 4)::int positive, count(*) filter (where rating <= 3)::int negative,
           count(*) filter (where sent_at is not null)::int requested
    from review_requests where business_id = ${businessId} and coalesce(responded_at, sent_at, created_at) >= ${from} and coalesce(responded_at, sent_at, created_at) < ${to}`);

  const [recalls] = await rows<{ sent: number; rebooked: number }>(sql`
    select count(*)::int sent,
           count(*) filter (where exists (
             select 1 from appointments a where a.customer_id = n.customer_id and a.created_at > n.created_at and a.created_at < n.created_at + interval '30 days'
           ))::int rebooked
    from notifications n where n.business_id = ${businessId} and n.template_name = 'recall_reminder' and n.status not in ('skipped','failed')
      and n.created_at >= ${from} and n.created_at < ${to}`);

  const [deposits] = await rows<{ paid: number; paid_cents: number; expired: number }>(sql`
    select (select count(*) from payments p where p.business_id = ${businessId} and p.kind = 'deposit' and p.status = 'succeeded' and p.created_at >= ${from} and p.created_at < ${to})::int paid,
           (select coalesce(sum(amount_cents), 0) from payments p where p.business_id = ${businessId} and p.kind = 'deposit' and p.status = 'succeeded' and p.created_at >= ${from} and p.created_at < ${to})::int paid_cents,
           (select count(*) from appointments a where a.business_id = ${businessId} and a.cancel_reason = 'Deposit not received in time' and a.cancelled_at >= ${from} and a.cancelled_at < ${to})::int expired`);

  const o = outcomes ?? { completed: 0, no_show: 0, cancelled: 0, upcoming: 0, completed_cents: 0, booked_cents: 0 };
  const attended = num(o.completed) + num(o.no_show);
  const c = convos ?? { total: 0, human: 0, converted: 0 };
  const cl = callStats ?? { total: 0, answered: 0, booked: 0, transferred: 0, minutes: 0 };
  return {
    range: { from: range.from, to: range.to },
    bookingsBySource: bySource.map((r) => ({ source: r.source, count: num(r.n), cents: num(r.cents) })),
    totalBookings: bySource.reduce((s, r) => s + num(r.n), 0),
    daily: daily.map((d) => ({ day: d.day, count: num(d.n), ai: num(d.ai) })),
    outcomes: { completed: num(o.completed), noShow: num(o.no_show), cancelled: num(o.cancelled), upcoming: num(o.upcoming) },
    noShowRate: attended ? num(o.no_show) / attended : null,
    revenue: { completedCents: num(o.completed_cents), bookedCents: num(o.booked_cents) },
    ai: { bookings: num(ai?.n), cents: num(ai?.cents), afterHours: num(ai?.after_hours) },
    busiest: busiest.map((b) => ({ dow: num(b.dow), hour: num(b.hr), count: num(b.n) })),
    conversations: {
      total: num(c.total),
      aiOnly: num(c.total) - num(c.human),
      human: num(c.human),
      converted: num(c.converted),
      conversion: num(c.total) ? num(c.converted) / num(c.total) : null,
    },
    calls: { total: num(cl.total), answered: num(cl.answered), missed: num(cl.total) - num(cl.answered), booked: num(cl.booked), transferred: num(cl.transferred), minutes: num(cl.minutes) },
    reviews: { count: num(reviews?.n), average: reviews?.avg ?? null, positive: num(reviews?.positive), negative: num(reviews?.negative), requested: num(reviews?.requested) },
    recalls: { sent: num(recalls?.sent), rebooked: num(recalls?.rebooked) },
    deposits: { paid: num(deposits?.paid), paidCents: num(deposits?.paid_cents), expired: num(deposits?.expired) },
  };
}
