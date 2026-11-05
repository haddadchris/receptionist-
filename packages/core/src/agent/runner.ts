/**
 * Runs one receptionist turn: builds the prompt, loops LLM ↔ tools until the
 * model produces a reply, and returns the reply plus a full audit trail of tool
 * calls. Channel-agnostic: WhatsApp, web chat and voice all call this.
 *
 * DB access happens in short tenant transactions (one per tool call) so no
 * transaction is held open while waiting on the LLM.
 */
import { and, eq } from "drizzle-orm";
import { withTenant } from "../db/tenant";
import { customers, type AgentState, type Business, type ConversationLanguage, type ToolCallLog } from "../db/schema";
import { getStaffServiceLinks, getWeeklyHours, listServices, listStaff } from "../business/setup";
import { detectLanguage } from "../lib/lang";
import { normalizePhone } from "../lib/phone";
import { pickLocalized } from "../lib/i18n";
import { logger } from "../lib/logger";
import { buildDynamicPrompt, buildStablePrompt } from "./prompt";
import { executeTool, TOOL_DEFS, type ToolEffects } from "./tools";
import { getLLMProvider } from "./llm";
import type { LLMMessage, LLMProvider } from "./llm/types";

export type Channel = "whatsapp" | "voice" | "web_chat";

export type AgentTurnInput = {
  business: Business;
  conversationId: string;
  channel: Channel;
  verifiedPhone: string | null;
  /** Previous turns (plain text). */
  history: LLMMessage[];
  userText: string;
  state: AgentState;
  /** Language the conversation was in (fallback for short messages like "1"). */
  language?: ConversationLanguage | null;
  provider?: LLMProvider;
  onText?: (delta: string) => void;
  now?: Date;
  maxIterations?: number;
  signal?: AbortSignal;
};

export type AgentTurnResult = {
  reply: string;
  language: ConversationLanguage;
  toolLog: ToolCallLog[];
  effects: ToolEffects;
  state: AgentState;
  provider: string;
  llmCalls: number;
  usage: { inputTokens: number; outputTokens: number; cacheReadTokens: number };
  stop: string;
};

const FALLBACK: Record<ConversationLanguage, string> = {
  ar: "عذراً، صار في مشكلة صغيرة. حوّلتك لحدا من الفريق ورح يردّوا عليك قريباً 🙏",
  arabizi: "Sorry, sar fi moshkle zghire. 7awwaltak la 7ada men el team w ra7 yraddo 3alek 2arib 🙏",
  en: "Sorry, something went wrong on my side. I've passed your message to the team and they'll reply shortly 🙏",
  fr: "Désolée, un souci technique. J'ai transmis votre message à l'équipe, qui vous répondra rapidement 🙏",
};

/** Load everything the stable prompt needs (cache-friendly: same input → same bytes). */
export async function loadPromptData(business: Business) {
  return withTenant(business.id, async (tx) => {
    const [services, staff, links, hours] = await Promise.all([
      listServices(tx, business.id, { activeOnly: true, onlineOnly: true }),
      listStaff(tx, business.id, { activeOnly: true }),
      getStaffServiceLinks(tx, business.id),
      getWeeklyHours(tx, business.id, null),
    ]);
    const names = new Map(staff.map((s) => [s.id, s.name]));
    return {
      services: services.map((s) => ({ ...s, staffNames: links.filter((l) => l.serviceId === s.id).map((l) => names.get(l.staffId)!).filter(Boolean) })),
      staff: staff.filter((s) => s.bookableOnline).map((s) => ({ id: s.id, name: s.name, title: pickLocalized(s.title, "en") })),
      hours,
    };
  });
}

export async function runAgentTurn(input: AgentTurnInput): Promise<AgentTurnResult> {
  const provider = input.provider ?? getLLMProvider();
  const now = input.now ?? new Date();
  const business = input.business;
  const state: AgentState = structuredClone(input.state ?? {});
  const fallbackLang: ConversationLanguage = input.language ?? (business.defaultLanguage === "ar" ? "ar" : business.defaultLanguage);
  const detected = detectLanguage(input.userText, fallbackLang);
  // Very short replies ("1", "ok", "4:30") keep the conversation's language.
  let language = input.userText.trim().length <= 6 && input.language ? input.language : detected.language;
  // Phone calls are spoken in Arabic script (TTS can't read Arabizi).
  if (input.channel === "voice" && language === "arabizi") language = "ar";

  const phone = input.verifiedPhone ?? state.claimedPhone ?? null;
  const customer = phone
    ? await withTenant(business.id, async (tx) => {
        const p = normalizePhone(phone);
        if (!p) return null;
        const [c] = await tx.select().from(customers).where(and(eq(customers.businessId, business.id), eq(customers.phone, p)));
        return c ?? null;
      })
    : null;

  const data = await loadPromptData(business);
  const systemStable = buildStablePrompt({ business, ...data, channel: input.channel });
  const systemDynamic = buildDynamicPrompt({
    business,
    now,
    channel: input.channel,
    language,
    mixed: detected.mixed,
    customer: customer
      ? { name: customer.name, known: !!customer.lastVisitAt || customer.noShowCount > 0 || !!customer.name, phoneVerified: !!input.verifiedPhone, noShowCount: customer.noShowCount }
      : { name: state.customerName ?? null, known: false, phoneVerified: !!input.verifiedPhone },
    state,
  });

  const effects: ToolEffects = { bookedAppointmentIds: [], rescheduledAppointmentIds: [], cancelledAppointmentIds: [] };
  const toolLog: ToolCallLog[] = [];
  const messages: LLMMessage[] = [...input.history, { role: "user", text: input.userText }];
  const usage = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0 };
  const context = {
    businessName: business.name,
    personaName: business.aiSettings?.personaName || "Maya",
    language,
    customerName: customer?.name ?? state.customerName ?? null,
    knownCustomer: !!customer,
    state,
    channel: input.channel,
    timezone: business.timezone,
    now: now.toISOString(),
  };

  let reply = "";
  let stop = "end";
  let llmCalls = 0;
  const max = input.maxIterations ?? 6;
  try {
    for (let i = 0; i < max; i++) {
      llmCalls++;
      const res = await provider.complete({
        systemStable,
        systemDynamic,
        messages,
        tools: TOOL_DEFS,
        context,
        onText: input.onText,
        purpose: input.channel === "voice" ? "voice" : "chat",
        maxTokens: input.channel === "voice" ? 1024 : 2048,
        signal: input.signal,
      });
      usage.inputTokens += res.usage?.inputTokens ?? 0;
      usage.outputTokens += res.usage?.outputTokens ?? 0;
      usage.cacheReadTokens += res.usage?.cacheReadTokens ?? 0;
      stop = res.stop;
      if (res.stop === "refusal") {
        effects.handoff ??= { reason: "Model declined to answer", urgency: "normal" };
        reply = FALLBACK[language];
        break;
      }
      if (!res.toolCalls.length) {
        reply = res.text;
        break;
      }
      messages.push({ role: "assistant", text: res.text, toolCalls: res.toolCalls, raw: res.raw, provider: provider.name });
      const results = [];
      for (const call of res.toolCalls) {
        const started = Date.now();
        try {
          const r = await withTenant(business.id, (tx) =>
            executeTool(
              {
                tx,
                business,
                channel: input.channel,
                conversationId: input.conversationId,
                verifiedPhone: input.verifiedPhone ? normalizePhone(input.verifiedPhone) : null,
                customerId: customer?.id ?? null,
                customerName: customer?.name ?? state.customerName ?? null,
                language,
                state,
                now,
                effects,
              },
              call.name,
              call.input,
            ),
          );
          toolLog.push({ name: call.name, input: call.input, output: r.output, error: r.isError ? r.content : undefined, durationMs: Date.now() - started });
          results.push({ toolCallId: call.id, name: call.name, content: r.content, isError: r.isError });
        } catch (err) {
          logger.error("agent tool failed", { tool: call.name, err });
          const content = JSON.stringify({ error: "tool_failed", message: "Internal error; apologise and offer to take a message." });
          toolLog.push({ name: call.name, input: call.input, error: err instanceof Error ? err.message : String(err), durationMs: Date.now() - started });
          results.push({ toolCallId: call.id, name: call.name, content, isError: true });
        }
      }
      messages.push({ role: "tool", results });
      if (i === max - 1) reply = FALLBACK[language];
    }
  } catch (err) {
    logger.error("agent turn failed", { err, businessId: business.id, conversationId: input.conversationId });
    effects.handoff ??= { reason: "AI error", urgency: "normal" };
    reply = FALLBACK[language];
    stop = "error";
  }
  if (!reply.trim()) reply = FALLBACK[language];
  if (effects.bookedAppointmentIds.length || effects.rescheduledAppointmentIds.length || effects.cancelledAppointmentIds.length) state.confusedCount = 0;

  return { reply: reply.trim(), language, toolLog, effects, state, provider: provider.name, llmCalls, usage, stop };
}
