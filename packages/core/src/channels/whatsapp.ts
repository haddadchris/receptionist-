/**
 * WhatsApp channel: webhook ingestion → AI reply.
 *
 * 1. `ingestWhatsAppWebhook(payload)` (called by the webhook route after the
 *    signature check) stores inbound messages idempotently and enqueues a
 *    `whatsapp.reply` job per conversation. The route then processes the job
 *    right away with `after()`; the cron runner is the safety net.
 * 2. `processWhatsAppConversation` takes a per-conversation lease, batches all
 *    unanswered inbound messages, runs the agent and sends the reply.
 */
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { getDb } from "../db/client";
import { withSystem, withTenant } from "../db/tenant";
import { appointments, businesses, conversations, customers, messages, notifications, type Business, type Job } from "../db/schema";
import { getBusinessByWhatsAppPhoneId } from "../business/public";
import { getBusiness } from "../availability/loader";
import { setAppointmentStatus } from "../booking/service";
import { enqueueJob } from "../jobs/queue";
import { getWhatsAppProvider } from "../providers";
import type { InboundWhatsAppEvent } from "../providers/whatsapp/types";
import { getSTTProvider } from "../providers/stt";
import { checkAiAllowed } from "../billing/limits";
import { logger } from "../lib/logger";
import { audit } from "../lib/audit";
import { recordUsage } from "../lib/usage";
import { detectLanguage } from "../lib/lang";
import { onOutboundWhatsApp } from "../notifications/hooks";
import {
  acquireLease,
  appendMessage,
  getOrCreateConversation,
  loadHistory,
  pendingInbound,
  releaseLease,
  setConversationStatus,
} from "../agent/conversations";
import { runAgentTurn } from "../agent/runner";
import type { ConversationLanguage } from "../db/schema";

export const WHATSAPP_REPLY_JOB = "whatsapp.reply";

const PLACEHOLDER: Record<string, string> = {
  image: "[image]",
  location: "[location]",
  other: "[unsupported message]",
};

const VOICE_FALLBACK: Record<ConversationLanguage, string> = {
  ar: "عذراً، ما فيني إسمع الرسائل الصوتية هلّق 🙏 فيك تكتبلي شو بدك؟",
  arabizi: "Sorry, ma fiye esma3 el voice notes hala2 🙏 fik tektebli shu baddak?",
  en: "Sorry, I can't listen to voice notes right now 🙏 Could you type your message?",
  fr: "Désolée, je ne peux pas écouter les messages vocaux pour le moment 🙏 Pouvez-vous l'écrire ?",
};

const CONFIRMED_REPLY: Record<ConversationLanguage, string> = {
  ar: "شكراً! تأكّد موعدك ✅ منشوفك قريباً.",
  arabizi: "Merci! Ta2akkad maw3adak ✅ menshoufak 2arib.",
  en: "Thanks! Your appointment is confirmed ✅ See you soon.",
  fr: "Merci ! Votre rendez-vous est confirmé ✅ À bientôt.",
};

export type IngestResult = { processed: number; conversations: { businessId: string; conversationId: string }[] };

/** Store inbound messages / status updates from a (verified) webhook payload. */
export async function ingestWhatsAppWebhook(payload: unknown): Promise<IngestResult> {
  const provider = getWhatsAppProvider();
  const events = provider.parseWebhook(payload);
  const touched = new Map<string, { businessId: string; conversationId: string }>();
  let processed = 0;
  for (const ev of events) {
    try {
      if (ev.kind === "status") await applyStatus(ev);
      else {
        const r = await ingestMessage(ev);
        if (r) touched.set(r.conversationId, r);
      }
      processed++;
    } catch (err) {
      logger.error("whatsapp ingest failed", { err, providerMessageId: ev.providerMessageId });
    }
  }
  return { processed, conversations: [...touched.values()] };
}

async function applyStatus(ev: Extract<InboundWhatsAppEvent, { kind: "status" }>) {
  const business = await getBusinessByWhatsAppPhoneId(ev.phoneNumberId);
  if (!business) return;
  await withTenant(business.id, async (tx) => {
    await tx
      .update(notifications)
      .set({ status: ev.status, error: ev.error ?? null })
      .where(and(eq(notifications.businessId, business.id), eq(notifications.providerMessageId, ev.providerMessageId)));
    await tx
      .update(messages)
      .set({ status: ev.status })
      .where(and(eq(messages.businessId, business.id), eq(messages.providerMessageId, ev.providerMessageId)));
  });
}

async function ingestMessage(ev: Extract<InboundWhatsAppEvent, { kind: "message" }>) {
  const business = await getBusinessByWhatsAppPhoneId(ev.phoneNumberId);
  if (!business) {
    logger.warn("whatsapp message for unknown phone_number_id", { phoneNumberId: ev.phoneNumberId });
    return null;
  }
  let body = ev.text ?? PLACEHOLDER[ev.type] ?? null;
  let transcript: string | null = null;
  if (ev.type === "audio") {
    body = "[voice note]";
    if (ev.mediaId) {
      try {
        const media = await getWhatsAppProvider().downloadMedia(ev.mediaId);
        if (media.data.length) transcript = await getSTTProvider().transcribe(media.data, media.mimeType);
      } catch (err) {
        logger.warn("voice note transcription failed", { err: String(err) });
      }
    }
  }
  return withTenant(business.id, async (tx) => {
    const [customer] = await tx
      .insert(customers)
      .values({ businessId: business.id, phone: ev.from, name: ev.profileName ?? null, source: "whatsapp", consentWhatsapp: true, consentedAt: new Date() })
      .onConflictDoUpdate({
        target: [customers.businessId, customers.phone],
        set: { name: sql`coalesce(${customers.name}, excluded.name)`, updatedAt: new Date() },
      })
      .returning();
    const convo = await getOrCreateConversation(tx, business.id, { channel: "whatsapp", externalId: ev.from, customerId: customer!.id });
    const msg = await appendMessage(tx, {
      businessId: business.id,
      conversationId: convo.id,
      direction: "inbound",
      sender: "customer",
      body,
      transcript,
      contentType: ev.type === "audio" ? "audio" : ev.type === "image" ? "image" : "text",
      providerMessageId: ev.providerMessageId,
    });
    if (!msg) return null; // duplicate delivery
    // STOP keyword: honour opt-out immediately.
    if (/^\s*(stop|unsubscribe|ألغي الاشتراك|وقف)\s*$/i.test(body ?? "")) {
      await tx.update(customers).set({ consentMarketing: false, optedOutAt: new Date() }).where(eq(customers.id, customer!.id));
      await audit(tx, { businessId: business.id, actor: { type: "customer" }, action: "customer.opted_out", entityType: "customer", entityId: customer!.id });
    }
    await enqueueJob(tx, {
      type: WHATSAPP_REPLY_JOB,
      businessId: business.id,
      payload: { conversationId: convo.id },
      dedupeKey: `wa-reply:${msg.id}`,
      maxAttempts: 3,
    });
    return { businessId: business.id, conversationId: convo.id };
  });
}

/** Mark the matching job done after inline processing so cron doesn't repeat it. */
export async function completeReplyJobs(conversationId: string) {
  await getDb().execute(sql`
    update jobs set status = 'done', completed_at = now()
    where type = ${WHATSAPP_REPLY_JOB} and status = 'pending' and payload->>'conversationId' = ${conversationId}
  `);
}

export async function handleWhatsAppReplyJob(job: Job): Promise<void | { skipped: string }> {
  const { conversationId } = job.payload as { conversationId: string };
  if (!job.businessId) return { skipped: "no business" };
  const res = await processWhatsAppConversation(job.businessId, conversationId);
  if (res === "locked") {
    // Another worker is replying; it will pick up these messages when it loops.
    await withTenant(job.businessId, (tx) =>
      enqueueJob(tx, { type: WHATSAPP_REPLY_JOB, businessId: job.businessId, payload: { conversationId }, runAt: new Date(Date.now() + 5000), dedupeKey: `wa-reply-retry:${conversationId}:${Date.now()}` }),
    );
    return { skipped: "locked" };
  }
  return res === "done" ? undefined : { skipped: res };
}

/** Returns "done", "locked", or a reason the AI did not reply. */
export async function processWhatsAppConversation(businessId: string, conversationId: string): Promise<string> {
  if (!(await acquireLease(conversationId))) return "locked";
  try {
    for (let round = 0; round < 3; round++) {
      const outcome = await replyOnce(businessId, conversationId);
      if (outcome !== "replied") return outcome === "nothing" && round > 0 ? "done" : outcome;
    }
    return "done";
  } finally {
    await releaseLease(conversationId);
  }
}

async function replyOnce(businessId: string, conversationId: string): Promise<string> {
  const business = await withTenant(businessId, (tx) => getBusiness(tx, businessId));
  const ctx = await withTenant(businessId, async (tx) => {
    const [convo] = await tx.select().from(conversations).where(and(eq(conversations.businessId, businessId), eq(conversations.id, conversationId)));
    if (!convo) return null;
    const pending = await pendingInbound(tx, conversationId);
    const [customer] = convo.customerId ? await tx.select().from(customers).where(eq(customers.id, convo.customerId)) : [];
    return { convo, pending, customer: customer ?? null };
  });
  if (!ctx || !ctx.pending.length) return "nothing";
  const { convo, pending, customer } = ctx;
  if (convo.status !== "ai_active") return "human_takeover";
  const check = await checkAiAllowed(business, "whatsappAi");
  if (!check.ok) return `ai_blocked:${check.reason}`;
  if (business.aiSettings?.whatsappAutoReply === false) return "auto_reply_off";
  const phone = convo.externalId!;
  const lang = (convo.language as ConversationLanguage | null) ?? (customer?.preferredLanguage as ConversationLanguage | null) ?? null;

  const texts = pending.map((m) => (m.contentType === "audio" ? (m.transcript ?? "") : (m.body ?? ""))).filter(Boolean);
  const onlyUntranscribedAudio = pending.every((m) => m.contentType === "audio" && !m.transcript);
  if (onlyUntranscribedAudio) {
    await sendAndStore(business, conversationId, phone, VOICE_FALLBACK[lang ?? (business.defaultLanguage as ConversationLanguage)], []);
    return "replied";
  }
  const userText = texts.join("\n");

  // Reply "1" to a confirmation-request reminder → confirm the appointment without the LLM.
  if (/^\s*[1١]\s*$/.test(userText) && customer) {
    const confirmed = await confirmFromReminder(business, conversationId, customer.id);
    if (confirmed) {
      await sendAndStore(business, conversationId, phone, CONFIRMED_REPLY[lang ?? detectLanguage(userText, "ar").language], [
        { name: "confirm_appointment", input: { reply: "1" }, output: { appointment_id: confirmed } },
      ]);
      return "replied";
    }
  }
  const effectiveText = /^\s*[2٢]\s*$/.test(userText) && (await lastWasConfirmRequest(businessId, conversationId))
    ? ({ ar: "بدي غيّر موعدي", arabizi: "badde ghayer maw3ade", en: "I want to reschedule my appointment", fr: "Je voudrais déplacer mon rendez-vous" } as const)[lang ?? "ar"]
    : userText;

  const history = await withTenant(businessId, (tx) => loadHistory(tx, conversationId, { before: pending[0]!.createdAt, limit: 16 }));
  const result = await runAgentTurn({
    business,
    conversationId,
    channel: "whatsapp",
    verifiedPhone: phone,
    history,
    userText: effectiveText,
    state: convo.state ?? {},
    language: lang,
  });

  await sendAndStore(business, conversationId, phone, result.reply, result.toolLog);
  await withTenant(businessId, async (tx) => {
    await tx.update(conversations).set({ state: result.state, language: result.language }).where(eq(conversations.id, conversationId));
    await recordUsage(tx, businessId, "ai_message", 1, { timezone: business.timezone, metadata: { channel: "whatsapp", provider: result.provider, llmCalls: result.llmCalls, ...result.usage } });
    if (result.effects.messageTaken) {
      await appendMessage(tx, {
        businessId,
        conversationId,
        direction: "outbound",
        sender: "system",
        contentType: "event",
        body: `📝 Message for the team: ${result.effects.messageTaken.message}${result.effects.messageTaken.callbackRequested ? ` — callback requested (${result.effects.messageTaken.callbackPhone ?? phone})` : ""}`,
      });
      await audit(tx, { businessId, actor: { type: "ai" }, action: "message.taken", entityType: "conversation", entityId: conversationId, changes: result.effects.messageTaken });
    }
    if (result.effects.handoff) {
      await setConversationStatus(tx, businessId, conversationId, "human_takeover", { type: "ai", label: "WhatsApp agent" }, `${result.effects.handoff.urgency === "urgent" ? "URGENT — " : ""}${result.effects.handoff.reason}`);
    }
  });
  return "replied";
}

async function sendAndStore(business: Business, conversationId: string, to: string, body: string, toolLog: { name: string; input: unknown; output?: unknown; error?: string }[]) {
  let providerMessageId: string | null = null;
  let status: "sent" | "failed" = "sent";
  try {
    providerMessageId = (await getWhatsAppProvider().sendText({ phoneNumberId: business.whatsappPhoneNumberId, to, body })).providerMessageId;
  } catch (err) {
    status = "failed";
    logger.error("whatsapp send failed", { err, businessId: business.id });
  }
  await withTenant(business.id, (tx) =>
    appendMessage(tx, { businessId: business.id, conversationId, direction: "outbound", sender: "ai", body, providerMessageId, status, toolCalls: toolLog }),
  );
}

async function lastWasConfirmRequest(businessId: string, conversationId: string): Promise<boolean> {
  const [last] = await withTenant(businessId, (tx) =>
    tx
      .select({ body: messages.body, contentType: messages.contentType })
      .from(messages)
      .where(and(eq(messages.conversationId, conversationId), eq(messages.direction, "outbound")))
      .orderBy(desc(messages.createdAt))
      .limit(1),
  );
  return !!last && last.contentType === "template" && /(ردّ 1|Reply 1|Répondez 1|radd 1)/i.test(last.body ?? "");
}

async function confirmFromReminder(business: Business, conversationId: string, customerId: string): Promise<string | null> {
  if (!(await lastWasConfirmRequest(business.id, conversationId))) return null;
  return withTenant(business.id, async (tx) => {
    const [appt] = await tx
      .select()
      .from(appointments)
      .where(and(eq(appointments.businessId, business.id), eq(appointments.customerId, customerId), inArray(appointments.status, ["pending", "confirmed"]), sql`${appointments.startsAt} > now()`))
      .orderBy(appointments.startsAt)
      .limit(1);
    if (!appt) return null;
    await tx.update(appointments).set({ customerConfirmedAt: new Date() }).where(eq(appointments.id, appt.id));
    if (appt.status === "pending") await setAppointmentStatus(tx, business.id, appt.id, "confirmed", { type: "customer", label: "WhatsApp reply 1" });
    await audit(tx, { businessId: business.id, actor: { type: "customer" }, action: "appointment.customer_confirmed", entityType: "appointment", entityId: appt.id });
    return appt.id;
  });
}

/** Mirror template notifications (reminders etc.) into the customer's WhatsApp conversation. */
onOutboundWhatsApp(async (tx, e) => {
  const convo = await getOrCreateConversation(tx, e.businessId, { channel: "whatsapp", externalId: e.phone, customerId: e.customerId });
  await appendMessage(tx, {
    businessId: e.businessId,
    conversationId: convo.id,
    direction: "outbound",
    sender: "system",
    body: e.body,
    contentType: e.contentType,
    providerMessageId: e.providerMessageId,
    status: "sent",
  });
});

/** Dev/demo: build a Meta-shaped webhook payload for the WhatsApp simulator. */
export function simulatedInbound(input: { phoneNumberId: string; from: string; text: string; name?: string }) {
  const id = `sim-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  return {
    object: "whatsapp_business_account",
    entry: [
      {
        id: "sim",
        changes: [
          {
            field: "messages",
            value: {
              messaging_product: "whatsapp",
              metadata: { display_phone_number: "", phone_number_id: input.phoneNumberId },
              contacts: [{ wa_id: input.from.replace("+", ""), profile: { name: input.name ?? "" } }],
              messages: [{ id, from: input.from.replace("+", ""), timestamp: String(Math.floor(Date.now() / 1000)), type: "text", text: { body: input.text } }],
            },
          },
        ],
      },
    ],
  };
}

/** Used by the simulator to ensure a demo business has a WhatsApp id. */
export async function ensureSimulatorPhoneId(businessId: string): Promise<string> {
  const [b] = await withSystem((tx) => tx.select().from(businesses).where(eq(businesses.id, businessId)));
  if (b?.whatsappPhoneNumberId) return b.whatsappPhoneNumberId;
  const id = `sim-${businessId.slice(0, 8)}`;
  await withSystem((tx) => tx.update(businesses).set({ whatsappPhoneNumberId: id }).where(eq(businesses.id, businessId)));
  return id;
}
