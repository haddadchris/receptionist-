/**
 * Voice agent evals: scripted caller utterances (as STT would deliver them)
 * through VoiceCallSession — the same path as phone calls and the browser
 * simulator. Checks voice-specific behaviour: read-back confirmation before
 * booking/moving, speakable replies (no lists/emojis/URLs/"$"), at most three
 * spoken options, Arabic script for TTS, escalation and graceful failure.
 */
import { and, eq } from "drizzle-orm";
import { withTenant } from "../db/tenant";
import { appointments, services, type ConversationLanguage } from "../db/schema";
import { getBusiness } from "../availability/loader";
import { createBooking, upsertCustomer } from "../booking/service";
import { VoiceCallSession } from "../voice/session";
import { detectLanguage } from "../lib/lang";
import type { LLMProvider } from "../agent/llm/types";
import { SERVICE_EN, type ServiceKey } from "./scenarios";
import { evalNow, type ScenarioResult } from "./harness";

type VTurn = { caller: string; tools?: string[]; forbid?: string[]; lang?: ConversationLanguage; includes?: (string | RegExp)[] };
export type VoiceScenario = {
  id: string;
  existing?: { name: string; appointment?: { service: ServiceKey; dayOffset: number; hour: number } };
  turns: VTurn[];
  outcome: "booked" | "rescheduled" | "cancelled" | "handoff" | "message" | "none";
};

const W = ["create_booking", "reschedule_booking", "cancel_booking"];

export const VOICE_SCENARIOS: VoiceScenario[] = [
  {
    id: "voice-ar-book-with-readback",
    turns: [
      { caller: "بدي موعد تنظيف أسنان بكرا الصبح", tools: ["check_availability"], forbid: W, lang: "ar" },
      { caller: "الأول", forbid: W, lang: "ar" },
      { caller: "اسمي طوني حداد", forbid: W, lang: "ar", includes: [/بأكّدلك/] },
      { caller: "إيه", tools: ["create_booking"], lang: "ar" },
    ],
    outcome: "booked",
  },
  {
    id: "voice-ar-decline-readback",
    existing: { name: "Nadine Karam" },
    turns: [
      { caller: "بدي موعد فحص بكرا بعد الضهر", tools: ["check_availability"] },
      { caller: "التاني", forbid: W, includes: [/بأكّدلك/] },
      { caller: "لا", forbid: W },
    ],
    outcome: "none",
  },
  {
    id: "voice-en-returning-caller",
    existing: { name: "Marc Rizk" },
    turns: [
      { caller: "Hi, I'd like a checkup tomorrow afternoon", tools: ["check_availability"], lang: "en" },
      { caller: "the second one", forbid: W, includes: [/Shall I book it/] },
      { caller: "yes please", tools: ["create_booking"], lang: "en" },
    ],
    outcome: "booked",
  },
  {
    id: "voice-ar-reschedule-with-readback",
    existing: { name: "Karim Haddad", appointment: { service: "checkup", dayOffset: 2, hour: 11 } },
    turns: [
      { caller: "بدي غيّر موعدي", tools: ["find_customer_appointments"], forbid: W },
      { caller: "بكرا الساعة 4", tools: ["check_availability"], forbid: W },
      { caller: "الأول", forbid: W },
      { caller: "إيه", tools: ["reschedule_booking"] },
    ],
    outcome: "rescheduled",
  },
  {
    id: "voice-ar-cancel",
    existing: { name: "Hiba Moussa", appointment: { service: "cleaning", dayOffset: 3, hour: 10 } },
    turns: [{ caller: "بدي ألغي موعدي", tools: ["find_customer_appointments", "cancel_booking"], lang: "ar" }],
    outcome: "cancelled",
  },
  { id: "voice-ar-price-spoken", turns: [{ caller: "قديش حق الحشوة؟", tools: ["list_services"], lang: "ar", includes: ["دولار"] }], outcome: "none" },
  { id: "voice-ar-emergency", turns: [{ caller: "عندي وجع كتير ونزيف بتمّي", tools: ["handoff_to_human"], forbid: W, lang: "ar" }], outcome: "handoff" },
  {
    id: "voice-confused-twice-offers-message",
    turns: [
      { caller: "امم", forbid: W },
      { caller: "شو؟", forbid: W, includes: [/رسالة|حوّلك/] },
      { caller: "إيه", tools: ["take_message"] },
    ],
    outcome: "message",
  },
  { id: "voice-fr-hours", turns: [{ caller: "Vous êtes ouverts le samedi ?", tools: ["get_business_info"], lang: "fr" }], outcome: "none" },
  { id: "voice-arabizi-stt-speaks-arabic", turns: [{ caller: "badde maw3ad tanzif bukra", tools: ["check_availability"], lang: "ar" }], outcome: "none" },
];

const VISUAL = /[\n•]|https?:\/\/|\$|[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u;

function subseq(needle: string[], hay: string[]) {
  let i = 0;
  for (const h of hay) if (h === needle[i]) i++;
  return i === needle.length;
}

export async function runVoiceScenario(businessId: string, sc: VoiceScenario, index: number, provider?: LLMProvider): Promise<ScenarioResult> {
  const started = Date.now();
  const now = evalNow();
  const business = await withTenant(businessId, (tx) => getBusiness(tx, businessId));
  const phone = `+96178${String(200000 + index * 41).padStart(6, "0")}`;
  const failures: string[] = [];
  let existingId: string | null = null;
  let existingStart: string | null = null;
  await withTenant(businessId, async (tx) => {
    if (!sc.existing) return;
    if (sc.existing.appointment) {
      const ap = sc.existing.appointment;
      const svc = (await tx.select().from(services).where(eq(services.businessId, businessId))).find((s) => s.name.en === SERVICE_EN[ap.service])!;
      const a = await createBooking(tx, businessId, {
        serviceId: svc.id,
        startsAt: now.plus({ days: ap.dayOffset }).set({ hour: ap.hour, minute: 0 }).toJSDate(),
        customer: { phone, name: sc.existing.name },
        source: "dashboard",
        actor: { type: "system", label: "eval" },
        override: true,
        notifyCustomer: false,
        now: now.minus({ days: 1 }).toJSDate(),
      });
      existingId = a.id;
      existingStart = a.startsAt.toISOString();
    } else await upsertCustomer(tx, businessId, { phone, name: sc.existing.name });
  });

  const session = await VoiceCallSession.start({ business, provider: "browser", from: phone, pipeline: "browser_text" });
  const turns: ScenarioResult["turns"] = [];
  let handoff = false;
  let message = false;
  try {
    for (const t of sc.turns) {
      // Voice evals run on the eval clock so "bukra" is deterministic.
      const res = await session.handleCallerText(t.caller, { provider, now: now.toJSDate() });
      const tools = res.toolLog.map((x) => x.name);
      if (res.effects.handoff) handoff = true;
      if (res.effects.messageTaken) message = true;
      const tf: string[] = [];
      if (t.tools && !subseq(t.tools, tools)) tf.push(`expected tools ${t.tools.join("→")} got [${tools.join(", ")}]`);
      for (const f of t.forbid ?? []) if (tools.includes(f)) tf.push(`forbidden tool ${f}`);
      if (VISUAL.test(res.reply)) tf.push("reply not speakable (list/emoji/URL/$)");
      const numbered = res.reply.match(/(^|\s)\d\.\s/g)?.length ?? 0;
      if (numbered > 0) tf.push("reply contains a numbered list");
      if (t.lang && detectLanguage(res.reply, t.lang).language !== t.lang) tf.push(`reply language ${detectLanguage(res.reply, t.lang).language}, expected ${t.lang}`);
      for (const inc of t.includes ?? []) if (!(typeof inc === "string" ? res.reply.includes(inc) : inc.test(res.reply))) tf.push(`reply missing ${inc}`);
      turns.push({ user: t.caller, reply: res.reply, tools, failures: tf });
      failures.push(...tf.map((f) => `turn "${t.caller.slice(0, 30)}": ${f}`));
    }
  } finally {
    await session.end({ countUsage: false });
  }

  const created = await withTenant(businessId, (tx) =>
    tx.select().from(appointments).where(and(eq(appointments.businessId, businessId), eq(appointments.conversationId, session.conversationId))),
  );
  const existing = existingId ? (await withTenant(businessId, (tx) => tx.select().from(appointments).where(eq(appointments.id, existingId!))))[0] : null;
  switch (sc.outcome) {
    case "booked":
      if (!created.some((a) => a.status !== "cancelled")) failures.push("outcome: no booking created");
      break;
    case "rescheduled":
      if (!existing || existing.startsAt.toISOString() === existingStart) failures.push("outcome: appointment not moved");
      break;
    case "cancelled":
      if (existing?.status !== "cancelled") failures.push("outcome: appointment not cancelled");
      break;
    case "handoff":
      if (!handoff) failures.push("outcome: no handoff");
      break;
    case "message":
      if (!message) failures.push("outcome: no message taken");
      break;
    case "none":
      if (created.length) failures.push("outcome: unexpected booking");
      if (existing && (existing.status === "cancelled" || existing.startsAt.toISOString() !== existingStart)) failures.push("outcome: existing appointment changed");
      break;
  }
  return { id: sc.id, category: "voice", language: "voice", pass: failures.length === 0, failures, turns, ms: Date.now() - started };
}

export async function runVoiceEvals(businessId: string, opts: { provider?: LLMProvider; onResult?: (r: ScenarioResult) => void; filter?: (s: VoiceScenario) => boolean } = {}) {
  const results: ScenarioResult[] = [];
  for (const [i, sc] of VOICE_SCENARIOS.filter(opts.filter ?? (() => true)).entries()) {
    let r: ScenarioResult;
    try {
      r = await runVoiceScenario(businessId, sc, i, opts.provider);
    } catch (e) {
      r = { id: sc.id, category: "voice", language: "voice", pass: false, failures: [`crashed: ${e instanceof Error ? e.stack : String(e)}`], turns: [], ms: 0 };
    }
    results.push(r);
    opts.onResult?.(r);
  }
  return results;
}
