/**
 * Web chat channel (embeddable widget, live demo, owner's "test your
 * receptionist"). Same agent and tools as WhatsApp; the visitor is
 * unverified, so the agent asks for a phone number before booking and can only
 * manage appointments created in the same chat.
 */
import { randomUUID } from "node:crypto";
import { and, asc, eq } from "drizzle-orm";
import { withTenant } from "../db/tenant";
import { conversations, messages, type Business, type ConversationLanguage } from "../db/schema";
import { signValue, verifyValue } from "../booking/tokens";
import { checkAiAllowed } from "../billing/limits";
import { recordUsage } from "../lib/usage";
import { DomainError } from "../lib/errors";
import { acquireLease, appendMessage, getOrCreateConversation, loadHistory, releaseLease, setConversationStatus } from "../agent/conversations";
import { runAgentTurn } from "../agent/runner";
import { aiReplyAllowed, CAP_REPLY } from "../agent/caps";
import type { LLMProvider } from "../agent/llm/types";

export function newWebChatToken(): string {
  return signValue(`${randomUUID()}`, "webchat");
}

export function webChatSessionFromToken(token: string | null | undefined): string | null {
  return token ? verifyValue(token, "webchat") : null;
}

export type WebChatTurn = { token: string; reply: string; conversationId: string; handoff: boolean; status: string };

export async function handleWebChatMessage(input: {
  business: Business;
  token?: string | null;
  text: string;
  provider?: LLMProvider;
  /** Owner test chats don't count against usage limits. */
  test?: boolean;
}): Promise<WebChatTurn> {
  const text = input.text.trim().slice(0, 1000);
  if (!text) throw new DomainError("VALIDATION", "Empty message");
  const check = input.test ? ({ ok: true } as const) : await checkAiAllowed(input.business, "webChat");
  const blocked = check.ok ? null : check.reason;
  if (blocked) throw new DomainError("PLAN_LIMIT", `Web chat unavailable (${blocked})`, { reason: blocked });
  let session = webChatSessionFromToken(input.token);
  let token = input.token ?? "";
  if (!session) {
    token = newWebChatToken();
    session = webChatSessionFromToken(token)!;
  }
  const business = input.business;
  const convo = await withTenant(business.id, (tx) => getOrCreateConversation(tx, business.id, { channel: "web_chat", externalId: session! }));
  const history = await withTenant(business.id, (tx) => loadHistory(tx, convo.id, { limit: 16 }));
  await withTenant(business.id, (tx) =>
    appendMessage(tx, { businessId: business.id, conversationId: convo.id, direction: "inbound", sender: "customer", body: text }),
  );
  if (convo.status !== "ai_active") {
    return { token, reply: "", conversationId: convo.id, handoff: true, status: convo.status };
  }
  if (!input.test && !(await aiReplyAllowed(convo.id))) {
    const l = (convo.language as ConversationLanguage | null) ?? (business.defaultLanguage as ConversationLanguage);
    await withTenant(business.id, async (tx) => {
      await appendMessage(tx, { businessId: business.id, conversationId: convo.id, direction: "outbound", sender: "system", body: CAP_REPLY[l] });
      await setConversationStatus(tx, business.id, convo.id, "human_takeover", { type: "system", label: "AI cap" }, "Hourly AI reply limit reached for this chat");
    });
    return { token, reply: CAP_REPLY[l], conversationId: convo.id, handoff: true, status: "human_takeover" };
  }
  // One reply at a time per chat session.
  for (let i = 0; i < 20 && !(await acquireLease(convo.id, 60)); i++) await new Promise((r) => setTimeout(r, 300));
  try {
    const result = await runAgentTurn({
      business,
      conversationId: convo.id,
      channel: "web_chat",
      verifiedPhone: null,
      history,
      userText: text,
      state: convo.state ?? {},
      language: (convo.language as ConversationLanguage | null) ?? null,
      provider: input.provider,
    });
    await withTenant(business.id, async (tx) => {
      await appendMessage(tx, { businessId: business.id, conversationId: convo.id, direction: "outbound", sender: "ai", body: result.reply, toolCalls: result.toolLog, status: "sent" });
      await tx.update(conversations).set({ state: result.state, language: result.language }).where(eq(conversations.id, convo.id));
      if (!input.test) await recordUsage(tx, business.id, "ai_message", 1, { timezone: business.timezone, metadata: { channel: "web_chat", provider: result.provider, ...result.usage } });
      if (result.effects.handoff) {
        await setConversationStatus(tx, business.id, convo.id, "human_takeover", { type: "ai", label: "web chat agent" }, result.effects.handoff.reason);
      }
    });
    return { token, reply: result.reply, conversationId: convo.id, handoff: !!result.effects.handoff, status: result.effects.handoff ? "human_takeover" : "ai_active" };
  } finally {
    await releaseLease(convo.id);
  }
}

/** Messages of a web chat session (for restoring the widget after reload, and for staff replies). */
export async function webChatHistory(business: Business, token: string) {
  const session = webChatSessionFromToken(token);
  if (!session) return [];
  return withTenant(business.id, async (tx) => {
    const [convo] = await tx
      .select()
      .from(conversations)
      .where(and(eq(conversations.businessId, business.id), eq(conversations.channel, "web_chat"), eq(conversations.externalId, session)));
    if (!convo) return [];
    const rows = await tx.select().from(messages).where(eq(messages.conversationId, convo.id)).orderBy(asc(messages.createdAt)).limit(100);
    return rows
      .filter((m) => m.contentType !== "event" && m.body)
      .map((m) => ({ id: m.id, role: m.direction === "inbound" ? ("user" as const) : ("assistant" as const), text: m.body!, staff: m.sender === "staff" }));
  });
}
