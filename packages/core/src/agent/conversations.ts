/** Conversation + message persistence shared by WhatsApp, web chat, voice and the inbox. */
import { and, asc, desc, eq, gt, ne, sql } from "drizzle-orm";
import { getDb } from "../db/client";
import type { Tx } from "../db/tenant";
import { conversations, messages, type Conversation, type Message, type ToolCallLog } from "../db/schema";
import { audit, type Actor } from "../lib/audit";
import { DomainError } from "../lib/errors";
import type { LLMMessage } from "./llm/types";

export type ChannelKind = "whatsapp" | "voice" | "web_chat";

export async function getOrCreateConversation(
  tx: Tx,
  businessId: string,
  input: { channel: ChannelKind; externalId: string; customerId?: string | null },
): Promise<Conversation> {
  const [existing] = await tx
    .select()
    .from(conversations)
    .where(
      and(
        eq(conversations.businessId, businessId),
        eq(conversations.channel, input.channel),
        eq(conversations.externalId, input.externalId),
        ne(conversations.status, "closed"),
      ),
    )
    .orderBy(desc(conversations.createdAt))
    .limit(1);
  if (existing) {
    if (input.customerId && existing.customerId !== input.customerId) {
      const [u] = await tx.update(conversations).set({ customerId: input.customerId }).where(eq(conversations.id, existing.id)).returning();
      return u!;
    }
    return existing;
  }
  const [created] = await tx
    .insert(conversations)
    .values({ businessId, channel: input.channel, externalId: input.externalId, customerId: input.customerId ?? null, status: "ai_active" })
    .returning();
  return created!;
}

export async function getConversation(tx: Tx, businessId: string, id: string): Promise<Conversation> {
  const [c] = await tx.select().from(conversations).where(and(eq(conversations.businessId, businessId), eq(conversations.id, id)));
  if (!c) throw new DomainError("NOT_FOUND", "Conversation not found");
  return c;
}

export async function appendMessage(
  tx: Tx,
  input: {
    businessId: string;
    conversationId: string;
    direction: "inbound" | "outbound";
    sender: "customer" | "ai" | "staff" | "system";
    body: string | null;
    contentType?: "text" | "audio" | "image" | "template" | "event";
    senderUserId?: string | null;
    providerMessageId?: string | null;
    mediaUrl?: string | null;
    transcript?: string | null;
    toolCalls?: ToolCallLog[] | null;
    status?: "queued" | "sent" | "delivered" | "read" | "failed" | null;
  },
): Promise<Message | null> {
  const rows = await tx
    .insert(messages)
    .values({
      businessId: input.businessId,
      conversationId: input.conversationId,
      direction: input.direction,
      sender: input.sender,
      body: input.body,
      contentType: input.contentType ?? "text",
      senderUserId: input.senderUserId ?? null,
      providerMessageId: input.providerMessageId ?? null,
      mediaUrl: input.mediaUrl ?? null,
      transcript: input.transcript ?? null,
      toolCalls: input.toolCalls ?? null,
      status: input.status ?? null,
    })
    .onConflictDoNothing()
    .returning();
  const msg = rows[0] ?? null;
  if (!msg) return null; // duplicate inbound (webhook retry)
  const inbound = input.direction === "inbound";
  await tx
    .update(conversations)
    .set({
      lastMessageAt: msg.createdAt,
      ...(inbound ? { lastInboundAt: msg.createdAt, unreadCount: sql`${conversations.unreadCount} + 1` } : {}),
      ...(input.contentType === "event" && input.sender === "system" ? { unreadCount: sql`${conversations.unreadCount} + 1` } : {}),
    })
    .where(eq(conversations.id, input.conversationId));
  return msg;
}

/** Recent turns as plain-text LLM history (oldest first). Events and empty bodies are skipped. */
export async function loadHistory(tx: Tx, conversationId: string, opts: { limit?: number; before?: Date } = {}): Promise<LLMMessage[]> {
  const rows = await tx
    .select()
    .from(messages)
    .where(and(eq(messages.conversationId, conversationId), opts.before ? sql`${messages.createdAt} < ${opts.before.toISOString()}::timestamptz` : undefined))
    .orderBy(desc(messages.createdAt))
    .limit(opts.limit ?? 16);
  const out: LLMMessage[] = [];
  for (const m of rows.reverse()) {
    const text = (m.transcript ?? m.body ?? "").trim();
    if (!text || m.contentType === "event") continue;
    if (m.direction === "inbound") out.push({ role: "user", text });
    else out.push({ role: "assistant", text: m.sender === "staff" ? `(staff) ${text}` : text });
  }
  // Merge consecutive same-role turns and make sure history starts with the user.
  const merged: LLMMessage[] = [];
  for (const m of out) {
    const prev = merged.at(-1);
    if (prev && prev.role === m.role && (m.role === "user" || m.role === "assistant")) {
      (prev as { text: string }).text += `\n${(m as { text: string }).text}`;
    } else merged.push({ ...m });
  }
  while (merged[0] && merged[0].role !== "user") merged.shift();
  return merged;
}

/** Inbound messages the AI hasn't answered yet (after the last outbound non-template message). */
export async function pendingInbound(tx: Tx, conversationId: string): Promise<Message[]> {
  const [lastOut] = await tx
    .select({ createdAt: messages.createdAt })
    .from(messages)
    .where(and(eq(messages.conversationId, conversationId), eq(messages.direction, "outbound"), ne(messages.contentType, "event"), ne(messages.contentType, "template")))
    .orderBy(desc(messages.createdAt))
    .limit(1);
  return tx
    .select()
    .from(messages)
    .where(and(eq(messages.conversationId, conversationId), eq(messages.direction, "inbound"), lastOut ? gt(messages.createdAt, lastOut.createdAt) : undefined))
    .orderBy(asc(messages.createdAt));
}

/** Try to take the per-conversation processing lease (system connection; short statement). */
export async function acquireLease(conversationId: string, seconds = 90): Promise<boolean> {
  const rows = await getDb()
    .update(conversations)
    .set({ processingUntil: sql`now() + make_interval(secs => ${seconds})` })
    .where(and(eq(conversations.id, conversationId), sql`(${conversations.processingUntil} is null or ${conversations.processingUntil} < now())`))
    .returning({ id: conversations.id });
  return rows.length > 0;
}

export async function releaseLease(conversationId: string): Promise<void> {
  await getDb().update(conversations).set({ processingUntil: null }).where(eq(conversations.id, conversationId));
}

export async function setConversationStatus(
  tx: Tx,
  businessId: string,
  conversationId: string,
  status: "ai_active" | "human_takeover" | "closed",
  actor: Actor,
  reason?: string,
): Promise<void> {
  const c = await getConversation(tx, businessId, conversationId);
  if (c.status === status) return;
  await tx
    .update(conversations)
    .set({ status, assignedUserId: actor.type === "user" && status === "human_takeover" ? actor.userId : status === "ai_active" ? null : c.assignedUserId })
    .where(eq(conversations.id, conversationId));
  const label =
    status === "human_takeover"
      ? `🙋 ${actor.type === "ai" ? "AI handed off to the team" : "Staff took over"}${reason ? `: ${reason}` : ""}`
      : status === "ai_active"
        ? "🤖 AI receptionist resumed"
        : "Conversation closed";
  await appendMessage(tx, { businessId, conversationId, direction: "outbound", sender: "system", body: label, contentType: "event" });
  await audit(tx, { businessId, actor, action: `conversation.${status}`, entityType: "conversation", entityId: conversationId, changes: { reason } });
}

export async function markRead(tx: Tx, businessId: string, conversationId: string): Promise<void> {
  await tx.update(conversations).set({ unreadCount: 0 }).where(and(eq(conversations.businessId, businessId), eq(conversations.id, conversationId)));
}
