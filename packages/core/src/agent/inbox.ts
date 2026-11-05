/** Inbox queries and staff actions. Tenant transaction required. */
import { and, asc, desc, eq, sql, type SQL } from "drizzle-orm";
import type { Tx } from "../db/tenant";
import { conversations, customers, messages, type Business } from "../db/schema";
import { getWhatsAppProvider } from "../providers";
import { appendMessage, getConversation, markRead, setConversationStatus } from "./conversations";
import { DomainError } from "../lib/errors";
import type { Actor } from "../lib/audit";

export type InboxRow = {
  id: string;
  channel: "whatsapp" | "voice" | "web_chat";
  status: "ai_active" | "human_takeover" | "closed";
  customerId: string | null;
  customerName: string | null;
  customerPhone: string | null;
  externalId: string | null;
  unreadCount: number;
  lastMessageAt: Date | null;
  preview: string | null;
  previewSender: string | null;
};

export async function listInbox(
  tx: Tx,
  businessId: string,
  opts: { status?: "ai_active" | "human_takeover" | "closed" | "needs_attention"; channel?: "whatsapp" | "voice" | "web_chat"; limit?: number } = {},
): Promise<InboxRow[]> {
  const conds: SQL[] = [eq(conversations.businessId, businessId)];
  if (opts.status === "needs_attention") conds.push(sql`(${conversations.status} = 'human_takeover' or ${conversations.unreadCount} > 0)`);
  else if (opts.status) conds.push(eq(conversations.status, opts.status));
  if (opts.channel) conds.push(eq(conversations.channel, opts.channel));
  const CID = sql.raw('"conversations"."id"');
  const rows = await tx
    .select({
      id: conversations.id,
      channel: conversations.channel,
      status: conversations.status,
      customerId: conversations.customerId,
      customerName: customers.name,
      customerPhone: customers.phone,
      externalId: conversations.externalId,
      unreadCount: conversations.unreadCount,
      lastMessageAt: conversations.lastMessageAt,
      preview: sql<string | null>`(select coalesce(m.transcript, m.body) from messages m where m.conversation_id = ${CID} order by m.created_at desc limit 1)`,
      previewSender: sql<string | null>`(select m.sender::text from messages m where m.conversation_id = ${CID} order by m.created_at desc limit 1)`,
    })
    .from(conversations)
    .leftJoin(customers, eq(customers.id, conversations.customerId))
    .where(and(...conds))
    .orderBy(desc(sql`coalesce(${conversations.lastMessageAt}, ${conversations.createdAt})`))
    .limit(opts.limit ?? 100);
  return rows;
}

export async function getThread(tx: Tx, businessId: string, conversationId: string) {
  const convo = await getConversation(tx, businessId, conversationId);
  const [customer] = convo.customerId ? await tx.select().from(customers).where(eq(customers.id, convo.customerId)) : [];
  const msgs = await tx.select().from(messages).where(eq(messages.conversationId, conversationId)).orderBy(asc(messages.createdAt)).limit(500);
  return { conversation: convo, customer: customer ?? null, messages: msgs };
}

/** Staff reply from the inbox. Taking over is implicit so the AI doesn't talk over staff. */
export async function staffReply(tx: Tx, business: Business, conversationId: string, body: string, actor: Extract<Actor, { type: "user" }>) {
  const text = body.trim();
  if (!text) throw new DomainError("VALIDATION", "Empty message");
  const convo = await getConversation(tx, business.id, conversationId);
  if (convo.status === "ai_active") await setConversationStatus(tx, business.id, conversationId, "human_takeover", actor);
  let providerMessageId: string | null = null;
  let status: "sent" | "failed" = "sent";
  if (convo.channel === "whatsapp" && convo.externalId) {
    try {
      providerMessageId = (await getWhatsAppProvider().sendText({ phoneNumberId: business.whatsappPhoneNumberId, to: convo.externalId, body: text })).providerMessageId;
    } catch {
      status = "failed";
    }
  }
  await appendMessage(tx, { businessId: business.id, conversationId, direction: "outbound", sender: "staff", senderUserId: actor.userId, body: text, providerMessageId, status });
  await markRead(tx, business.id, conversationId);
  return { status };
}
