/**
 * Customer timeline: every touchpoint in one chronological list — appointments
 * (with status changes), conversations, calls, messages we sent (reminders,
 * recalls, campaigns), reviews, deposits and consent changes.
 */
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import type { Tx } from "../db/tenant";
import { appointments, auditLog, calls, conversations, messages, notifications, payments, reviewRequests, services, staff } from "../db/schema";

export type TimelineItem =
  | { kind: "appointment"; at: Date; id: string; status: string; startsAt: Date; service: Record<string, string>; staffName: string; source: string; priceCents: number | null; depositStatus: string; depositCents: number }
  | { kind: "status"; at: Date; appointmentId: string; action: string; actorType: string }
  | { kind: "conversation"; at: Date; id: string; channel: string; status: string; messageCount: number; lastMessage: string | null }
  | { kind: "call"; at: Date; id: string; outcome: string | null; durationSeconds: number | null; summary: string | null }
  | { kind: "notification"; at: Date; template: string; status: string; body: string; campaignId: string | null }
  | { kind: "review"; at: Date; rating: number | null; feedback: string | null; status: string }
  | { kind: "payment"; at: Date; amountCents: number; status: string; method: string; reference: string | null }
  | { kind: "consent"; at: Date; action: string };

export async function customerTimeline(tx: Tx, businessId: string, customerId: string, limit = 150): Promise<TimelineItem[]> {
  const appts = await tx
    .select({ a: appointments, service: services.name, staffName: staff.name })
    .from(appointments)
    .innerJoin(services, eq(services.id, appointments.serviceId))
    .innerJoin(staff, eq(staff.id, appointments.staffId))
    .where(and(eq(appointments.businessId, businessId), eq(appointments.customerId, customerId)))
    .orderBy(desc(appointments.createdAt))
    .limit(100);
  const apptIds = appts.map((r) => r.a.id);
  const [convos, callRows, notes, reviews, pays, audits] = await Promise.all([
    tx
      .select({
        c: conversations,
        n: sql<number>`(select count(*)::int from ${messages} m where m.conversation_id = "conversations"."id" and m.content_type <> 'event')`,
        last: sql<string | null>`(select m.body from ${messages} m where m.conversation_id = "conversations"."id" and m.content_type <> 'event' order by m.created_at desc limit 1)`,
      })
      .from(conversations)
      .where(and(eq(conversations.businessId, businessId), eq(conversations.customerId, customerId), sql`${conversations.channel} <> 'voice'`))
      .orderBy(desc(conversations.lastMessageAt))
      .limit(30),
    tx.select().from(calls).where(and(eq(calls.businessId, businessId), eq(calls.customerId, customerId))).orderBy(desc(calls.startedAt)).limit(30),
    tx.select().from(notifications).where(and(eq(notifications.businessId, businessId), eq(notifications.customerId, customerId))).orderBy(desc(notifications.createdAt)).limit(60),
    tx.select().from(reviewRequests).where(and(eq(reviewRequests.businessId, businessId), eq(reviewRequests.customerId, customerId))).limit(30),
    apptIds.length ? tx.select().from(payments).where(and(eq(payments.businessId, businessId), inArray(payments.appointmentId, apptIds))) : Promise.resolve([]),
    tx
      .select()
      .from(auditLog)
      .where(
        and(
          eq(auditLog.businessId, businessId),
          apptIds.length
            ? sql`((${auditLog.entityType} = 'appointment' and ${auditLog.entityId} in (${sql.join(apptIds.map((id) => sql`${id}`), sql`, `)})) or (${auditLog.entityType} = 'customer' and ${auditLog.entityId} = ${customerId}))`
            : sql`${auditLog.entityType} = 'customer' and ${auditLog.entityId} = ${customerId}`,
        ),
      )
      .orderBy(desc(auditLog.createdAt))
      .limit(100),
  ]);

  const items: TimelineItem[] = [];
  for (const r of appts) {
    items.push({
      kind: "appointment",
      at: r.a.createdAt,
      id: r.a.id,
      status: r.a.status,
      startsAt: r.a.startsAt,
      service: r.service,
      staffName: r.staffName,
      source: r.a.source,
      priceCents: r.a.priceCents,
      depositStatus: r.a.depositStatus,
      depositCents: r.a.depositCents,
    });
  }
  for (const a of audits) {
    if (a.entityType === "appointment" && a.action !== "appointment.created") {
      items.push({ kind: "status", at: a.createdAt, appointmentId: a.entityId!, action: a.action, actorType: a.actorType });
    } else if (a.entityType === "customer" && /opted_out|consent|tag/.test(a.action)) {
      items.push({ kind: "consent", at: a.createdAt, action: a.action });
    }
  }
  for (const c of convos) {
    items.push({ kind: "conversation", at: c.c.lastMessageAt ?? c.c.createdAt, id: c.c.id, channel: c.c.channel, status: c.c.status, messageCount: c.n, lastMessage: c.last });
  }
  for (const c of callRows) items.push({ kind: "call", at: c.startedAt, id: c.id, outcome: c.outcome, durationSeconds: c.durationSeconds, summary: c.summary });
  for (const n of notes) items.push({ kind: "notification", at: n.sentAt ?? n.createdAt, template: n.templateName, status: n.status, body: n.body, campaignId: n.campaignId });
  for (const r of reviews) if (r.respondedAt || r.sentAt) items.push({ kind: "review", at: r.respondedAt ?? r.sentAt!, rating: r.rating, feedback: r.feedback, status: r.status });
  for (const p of pays) items.push({ kind: "payment", at: p.createdAt, amountCents: p.amountCents, status: p.status, method: p.method, reference: p.providerRef });
  return items.sort((a, b) => b.at.getTime() - a.at.getTime()).slice(0, limit);
}
