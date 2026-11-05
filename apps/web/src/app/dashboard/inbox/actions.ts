"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { markRead, setConversationStatus } from "@fekerte/core/agent/conversations";
import { staffReply } from "@fekerte/core/agent/inbox";
import { ensureSimulatorPhoneId, ingestWhatsAppWebhook, processWhatsAppConversation, completeReplyJobs, simulatedInbound } from "@fekerte/core/channels/whatsapp";
import { normalizePhone } from "@fekerte/core/lib/phone";
import { DomainError } from "@fekerte/core/lib/errors";
import { getWhatsAppProvider } from "@fekerte/core/providers/index";
import { tenantAction, runAction } from "@/lib/actions";
import { requireWritableBusiness } from "@/lib/auth/current";

const uuid = z.string().uuid();
const refresh = () => revalidatePath("/dashboard/inbox", "layout");

export async function replyAction(input: { conversationId: string; body: string }) {
  const res = await tenantAction(async (tx, ctx) => {
    const p = z.object({ conversationId: uuid, body: z.string().min(1).max(4000) }).parse(input);
    if (ctx.actor.type !== "user") throw new DomainError("FORBIDDEN", "Staff only");
    return staffReply(tx, ctx.business, p.conversationId, p.body, ctx.actor);
  });
  if (res.ok) refresh();
  return res;
}

export async function setStatusAction(input: { conversationId: string; status: "ai_active" | "human_takeover" | "closed" }) {
  const res = await tenantAction(async (tx, ctx) => {
    const p = z.object({ conversationId: uuid, status: z.enum(["ai_active", "human_takeover", "closed"]) }).parse(input);
    await setConversationStatus(tx, ctx.business.id, p.conversationId, p.status, ctx.actor);
    return null;
  });
  if (res.ok) refresh();
  return res;
}

export async function markReadAction(conversationId: string) {
  return tenantAction(async (tx, ctx) => {
    await markRead(tx, ctx.business.id, uuid.parse(conversationId));
    return null;
  });
}

/**
 * WhatsApp simulator (mock provider only): injects a Meta-shaped inbound
 * message through the exact same ingestion + AI path as the real webhook.
 */
export async function simulateInboundAction(input: { from: string; text: string; name?: string }) {
  const res = await runAction(async () => {
    const ctx = await requireWritableBusiness();
    if (getWhatsAppProvider().name !== "mock") throw new DomainError("FORBIDDEN", "Simulator is only available with the mock WhatsApp provider");
    const p = z.object({ from: z.string().min(6).max(30), text: z.string().min(1).max(2000), name: z.string().max(80).optional() }).parse(input);
    const from = normalizePhone(p.from);
    if (!from) throw new DomainError("VALIDATION", "Invalid phone", { field: "phone" });
    const phoneNumberId = await ensureSimulatorPhoneId(ctx.business.id);
    const result = await ingestWhatsAppWebhook(simulatedInbound({ phoneNumberId, from, text: p.text, name: p.name }));
    for (const c of result.conversations) {
      const outcome = await processWhatsAppConversation(c.businessId, c.conversationId);
      if (outcome !== "locked") await completeReplyJobs(c.conversationId);
    }
    return { conversationId: result.conversations[0]?.conversationId ?? null };
  });
  if (res.ok) refresh();
  return res;
}
