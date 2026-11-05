/** Call log queries (tenant transaction). */
import { and, asc, desc, eq, type SQL } from "drizzle-orm";
import type { Tx } from "../db/tenant";
import { calls, customers, messages } from "../db/schema";
import { getAppointmentView } from "../booking/service";
import { DomainError } from "../lib/errors";

export async function listCalls(tx: Tx, businessId: string, opts: { outcome?: string; limit?: number } = {}) {
  const conds: SQL[] = [eq(calls.businessId, businessId)];
  if (opts.outcome) conds.push(eq(calls.outcome, opts.outcome as never));
  return tx
    .select({ call: calls, customerName: customers.name })
    .from(calls)
    .leftJoin(customers, eq(customers.id, calls.customerId))
    .where(and(...conds))
    .orderBy(desc(calls.startedAt))
    .limit(opts.limit ?? 100);
}

export async function getCallDetail(tx: Tx, businessId: string, id: string) {
  const [row] = await tx
    .select({ call: calls, customerName: customers.name, customerPhone: customers.phone })
    .from(calls)
    .leftJoin(customers, eq(customers.id, calls.customerId))
    .where(and(eq(calls.businessId, businessId), eq(calls.id, id)));
  if (!row) throw new DomainError("NOT_FOUND", "Call not found");
  const appointment = row.call.appointmentId ? await getAppointmentView(tx, businessId, row.call.appointmentId) : null;
  const toolCalls = row.call.conversationId
    ? (await tx.select({ toolCalls: messages.toolCalls }).from(messages).where(eq(messages.conversationId, row.call.conversationId)).orderBy(asc(messages.createdAt)))
        .flatMap((m) => m.toolCalls ?? [])
    : [];
  return { ...row, appointment, toolCalls };
}
