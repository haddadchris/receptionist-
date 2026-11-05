/**
 * A voice call (phone or browser simulator) as a sequence of text turns.
 * All voice pipelines funnel into this:
 *  - cascade: streaming STT → handleCallerText → TTS
 *  - realtime: speech-to-speech model; tools run through executeVoiceTool
 *  - gather: Twilio <Gather input="speech"> turn-based fallback
 *  - browser text mode: Web Speech API in the browser
 *
 * State lives in the DB (calls.transcript, conversation.state, messages) so
 * stateless webhook paths can reload a session per request.
 */
import { and, asc, eq, sql } from "drizzle-orm";
import { withTenant } from "../db/tenant";
import { calls, conversations, customers, messages, type AgentState, type Business, type ToolCallLog, type TranscriptTurn } from "../db/schema";
import { getBusiness } from "../availability/loader";
import { appendMessage, getOrCreateConversation, loadHistory, setConversationStatus } from "../agent/conversations";
import { runAgentTurn } from "../agent/runner";
import { executeTool, type ToolEffects } from "../agent/tools";
import { getLLMProvider, llmProviderKind } from "../agent/llm";
import type { LLMProvider } from "../agent/llm/types";
import { normalizePhone } from "../lib/phone";
import { recordUsage } from "../lib/usage";
import { audit } from "../lib/audit";
import { logger } from "../lib/logger";
import { toSpeakable } from "./tts";
import type { ConversationLanguage } from "../db/schema";

export type VoicePipelineKind = "realtime" | "cascade" | "gather" | "browser_text";

const GREETING: Record<"ar" | "en" | "fr", (business: string, persona: string) => string> = {
  ar: (b, p) => `أهلا وسهلا، ${b}، معك ${p}. كيف فيني ساعدك؟`,
  en: (b, p) => `Hello, thank you for calling ${b}, this is ${p}. How can I help you?`,
  fr: (b, p) => `Bonjour, ${b}, ${p} à l'appareil. Comment puis-je vous aider ?`,
};

const voiceLang = (l: ConversationLanguage | null | undefined): "ar" | "en" | "fr" => (l === "en" || l === "fr" ? l : "ar");

export class VoiceCallSession {
  private constructor(
    public readonly business: Business,
    public readonly callId: string,
    public readonly conversationId: string,
    public readonly callerPhone: string | null,
    public state: AgentState,
    public language: ConversationLanguage,
    public readonly pipeline: VoicePipelineKind,
  ) {}

  static async start(input: {
    business: Business;
    provider: "twilio" | "browser";
    providerCallId?: string | null;
    from?: string | null;
    to?: string | null;
    pipeline: VoicePipelineKind;
  }): Promise<VoiceCallSession> {
    const b = input.business;
    const caller = input.from ? normalizePhone(input.from) : null;
    const { callId, conversationId } = await withTenant(b.id, async (tx) => {
      let customerId: string | null = null;
      if (caller) {
        const [c] = await tx.select({ id: customers.id }).from(customers).where(and(eq(customers.businessId, b.id), eq(customers.phone, caller)));
        customerId = c?.id ?? null;
      }
      const [call] = await tx
        .insert(calls)
        .values({
          businessId: b.id,
          customerId,
          provider: input.provider,
          providerCallId: input.providerCallId ?? null,
          direction: "inbound",
          fromNumber: caller ?? input.from ?? null,
          toNumber: input.to ?? null,
          pipeline: input.pipeline,
        })
        .returning();
      const convo = await getOrCreateConversation(tx, b.id, { channel: "voice", externalId: call!.id, customerId });
      await tx.update(calls).set({ conversationId: convo.id }).where(eq(calls.id, call!.id));
      return { callId: call!.id, conversationId: convo.id };
    });
    return new VoiceCallSession(b, callId, conversationId, caller, {}, b.defaultLanguage === "ar" ? "ar" : b.defaultLanguage, input.pipeline);
  }

  /** Reload a session (stateless webhook paths). */
  static async load(businessId: string, callId: string): Promise<VoiceCallSession | null> {
    const business = await withTenant(businessId, (tx) => getBusiness(tx, businessId));
    const row = await withTenant(businessId, async (tx) => {
      const [call] = await tx.select().from(calls).where(and(eq(calls.businessId, businessId), eq(calls.id, callId)));
      if (!call?.conversationId) return null;
      const [convo] = await tx.select().from(conversations).where(eq(conversations.id, call.conversationId));
      return convo ? { call, convo } : null;
    });
    if (!row) return null;
    return new VoiceCallSession(
      business,
      row.call.id,
      row.convo.id,
      row.call.fromNumber ? normalizePhone(row.call.fromNumber) : null,
      row.convo.state ?? {},
      (row.convo.language as ConversationLanguage | null) ?? (business.defaultLanguage === "ar" ? "ar" : business.defaultLanguage),
      (row.call.pipeline as VoicePipelineKind) ?? "gather",
    );
  }

  get speechLanguage(): "ar" | "en" | "fr" {
    return voiceLang(this.language);
  }

  greeting(): string {
    const persona = this.business.aiSettings?.personaName || "Maya";
    return GREETING[this.speechLanguage](this.business.name, persona);
  }

  private async appendTranscript(turn: TranscriptTurn) {
    await withTenant(this.business.id, (tx) =>
      tx
        .update(calls)
        .set({ transcript: sql`${calls.transcript} || ${JSON.stringify([turn])}::jsonb` })
        .where(eq(calls.id, this.callId)),
    );
  }

  async logAgent(text: string, toolCalls: ToolCallLog[] | null = null) {
    await this.appendTranscript({ role: "agent", text, at: new Date().toISOString() });
    await withTenant(this.business.id, (tx) =>
      appendMessage(tx, { businessId: this.business.id, conversationId: this.conversationId, direction: "outbound", sender: "ai", body: text, toolCalls, status: "sent" }),
    );
  }

  async logCaller(text: string) {
    await this.appendTranscript({ role: "caller", text, at: new Date().toISOString() });
    await withTenant(this.business.id, (tx) =>
      appendMessage(tx, { businessId: this.business.id, conversationId: this.conversationId, direction: "inbound", sender: "customer", body: text }),
    );
  }

  /**
   * One caller utterance → agent reply (already made speakable).
   * `onDelta` streams raw text for low-latency TTS; `signal` aborts on barge-in.
   */
  async handleCallerText(
    text: string,
    opts: { onDelta?: (d: string) => void; signal?: AbortSignal; provider?: LLMProvider; now?: Date } = {},
  ): Promise<{ reply: string; effects: ToolEffects; toolLog: ToolCallLog[] }> {
    const history = await withTenant(this.business.id, (tx) => loadHistory(tx, this.conversationId, { limit: 20 }));
    await this.logCaller(text);
    const result = await runAgentTurn({
      business: this.business,
      conversationId: this.conversationId,
      channel: "voice",
      verifiedPhone: this.callerPhone,
      history,
      userText: text,
      state: this.state,
      language: this.language,
      onText: opts.onDelta,
      signal: opts.signal,
      provider: opts.provider,
      now: opts.now,
    });
    // Voice always speaks Arabic script (TTS can't read Arabizi).
    this.language = result.language === "arabizi" ? "ar" : result.language;
    this.state = result.state;
    const reply = toSpeakable(result.reply, this.speechLanguage);
    await this.logAgent(reply, result.toolLog);
    await withTenant(this.business.id, async (tx) => {
      await tx.update(conversations).set({ state: this.state, language: this.language }).where(eq(conversations.id, this.conversationId));
      if (result.effects.messageTaken) {
        await appendMessage(tx, {
          businessId: this.business.id,
          conversationId: this.conversationId,
          direction: "outbound",
          sender: "system",
          contentType: "event",
          body: `📝 Voicemail/message: ${result.effects.messageTaken.message}${result.effects.messageTaken.callbackRequested ? ` — callback ${result.effects.messageTaken.callbackPhone ?? this.callerPhone ?? ""}` : ""}`,
        });
      }
      if (result.effects.handoff) {
        await setConversationStatus(tx, this.business.id, this.conversationId, "human_takeover", { type: "ai", label: "voice agent" }, result.effects.handoff.reason);
      }
      const booked = result.effects.bookedAppointmentIds[0] ?? result.effects.rescheduledAppointmentIds[0];
      if (booked) await tx.update(calls).set({ appointmentId: booked }).where(eq(calls.id, this.callId));
    });
    return { reply, effects: result.effects, toolLog: result.toolLog };
  }

  /** Run a tool for the realtime (speech-to-speech) pipeline, with the same guards as chat. */
  async executeVoiceTool(name: string, input: unknown): Promise<string> {
    const effects: ToolEffects = { bookedAppointmentIds: [], rescheduledAppointmentIds: [], cancelledAppointmentIds: [] };
    const started = Date.now();
    const customer = this.callerPhone
      ? await withTenant(this.business.id, async (tx) => {
          const [c] = await tx.select().from(customers).where(and(eq(customers.businessId, this.business.id), eq(customers.phone, this.callerPhone!)));
          return c ?? null;
        })
      : null;
    const r = await withTenant(this.business.id, (tx) =>
      executeTool(
        {
          tx,
          business: this.business,
          channel: "voice",
          conversationId: this.conversationId,
          verifiedPhone: this.callerPhone,
          customerId: customer?.id ?? null,
          customerName: customer?.name ?? this.state.customerName ?? null,
          language: this.language,
          state: this.state,
          now: new Date(),
          effects,
        },
        name,
        input,
      ),
    );
    const log: ToolCallLog = { name, input, output: r.output, error: r.isError ? r.content : undefined, durationMs: Date.now() - started };
    await withTenant(this.business.id, async (tx) => {
      await appendMessage(tx, { businessId: this.business.id, conversationId: this.conversationId, direction: "outbound", sender: "system", contentType: "event", body: `🔧 ${name}`, toolCalls: [log] });
      await tx.update(conversations).set({ state: this.state }).where(eq(conversations.id, this.conversationId));
      const booked = effects.bookedAppointmentIds[0] ?? effects.rescheduledAppointmentIds[0];
      if (booked) await tx.update(calls).set({ appointmentId: booked }).where(eq(calls.id, this.callId));
      if (effects.handoff) await setConversationStatus(tx, this.business.id, this.conversationId, "human_takeover", { type: "ai", label: "voice agent" }, effects.handoff.reason);
    });
    return r.content;
  }

  /** Finalize: duration, outcome, summary, usage. Idempotent. */
  async end(opts: { reason?: string; transferred?: boolean; countUsage?: boolean } = {}): Promise<void> {
    const b = this.business;
    const data = await withTenant(b.id, async (tx) => {
      const [call] = await tx.select().from(calls).where(eq(calls.id, this.callId));
      const msgs = await tx.select().from(messages).where(eq(messages.conversationId, this.conversationId)).orderBy(asc(messages.createdAt));
      return { call: call!, msgs };
    });
    if (data.call.endedAt) return;
    const tools = data.msgs.flatMap((m) => m.toolCalls ?? []);
    const ok = (n: string) => tools.some((t) => t.name === n && (t.output as { ok?: boolean } | undefined)?.ok);
    const callerTurns = data.msgs.filter((m) => m.direction === "inbound").length;
    const outcome = ok("create_booking")
      ? "booked"
      : ok("reschedule_booking")
        ? "rescheduled"
        : ok("cancel_booking")
          ? "cancelled"
          : opts.transferred || tools.some((t) => t.name === "handoff_to_human")
            ? "transferred"
            : tools.some((t) => t.name === "take_message")
              ? "message_taken"
              : callerTurns > 0
                ? "info"
                : "abandoned";
    const endedAt = new Date();
    const durationSeconds = Math.max(1, Math.round((endedAt.getTime() - data.call.startedAt.getTime()) / 1000));
    const summary = await summarizeCall(data.call.transcript ?? [], tools, outcome);
    await withTenant(b.id, async (tx) => {
      await tx.update(calls).set({ endedAt, durationSeconds, outcome, summary }).where(eq(calls.id, this.callId));
      await tx.update(conversations).set({ status: "closed", summary }).where(eq(conversations.id, this.conversationId));
      if (opts.countUsage !== false) {
        await recordUsage(tx, b.id, "voice_minute", Math.ceil(durationSeconds / 60), { timezone: b.timezone, metadata: { callId: this.callId, pipeline: this.pipeline } });
      }
      await audit(tx, { businessId: b.id, actor: { type: "ai", label: "voice agent" }, action: "call.ended", entityType: "call", entityId: this.callId, changes: { outcome, durationSeconds, reason: opts.reason } });
    });
  }
}

/** One-line summary for staff. Uses the LLM when a real provider is configured; deterministic otherwise. */
export async function summarizeCall(transcript: TranscriptTurn[], tools: ToolCallLog[], outcome: string): Promise<string> {
  const deterministic = (() => {
    const booked = tools.find((t) => t.name === "create_booking" && (t.output as { ok?: boolean })?.ok)?.output as { service?: string; start?: string; staff_name?: string } | undefined;
    if (booked) return `Booked ${booked.service} on ${booked.start?.replace("T", " ")} with ${booked.staff_name}.`;
    const moved = tools.find((t) => t.name === "reschedule_booking" && (t.output as { ok?: boolean })?.ok)?.output as { start?: string } | undefined;
    if (moved) return `Rescheduled appointment to ${moved.start?.replace("T", " ")}.`;
    if (tools.some((t) => t.name === "cancel_booking" && (t.output as { ok?: boolean })?.ok)) return "Cancelled an appointment.";
    const handoff = tools.find((t) => t.name === "handoff_to_human")?.input as { reason?: string; urgency?: string } | undefined;
    if (handoff) return `${handoff.urgency === "urgent" ? "URGENT — " : ""}Transferred to staff: ${handoff.reason}`;
    const msg = tools.find((t) => t.name === "take_message")?.input as { message?: string } | undefined;
    if (msg) return `Left a message: ${msg.message}`;
    const asked = [...new Set(tools.map((t) => t.name))];
    if (asked.length) return `Caller asked about ${asked.map((n) => n.replace(/_/g, " ")).join(", ")}.`;
    if (!transcript.some((t) => t.role === "caller")) return "Caller hung up without speaking.";
    return "General enquiry.";
  })();
  if (llmProviderKind() === "mock" || transcript.length < 2) return deterministic;
  try {
    const provider = getLLMProvider();
    const res = await provider.complete({
      systemStable: "You summarize phone calls for a clinic's staff. One sentence in English, factual, <= 30 words. Mention the outcome and any date/time booked.",
      systemDynamic: `Outcome: ${outcome}.`,
      messages: [{ role: "user", text: transcript.map((t) => `${t.role}: ${t.text}`).join("\n").slice(0, 8000) }],
      tools: [],
      maxTokens: 300,
      context: { businessName: "", personaName: "", language: "en", customerName: null, knownCustomer: false, state: {}, channel: "voice", timezone: "UTC", now: new Date().toISOString() },
    });
    return res.text.trim() || deterministic;
  } catch (err) {
    logger.warn("call summary failed", { err: String(err) });
    return deterministic;
  }
}
