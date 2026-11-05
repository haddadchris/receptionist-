/**
 * Eval harness: runs SCENARIOS against a freshly created copy of the demo
 * dental clinic, through the real agent runner + tools + database.
 */
import { and, eq } from "drizzle-orm";
import { DateTime } from "luxon";
import { withSystem, withTenant } from "../db/tenant";
import { appointments, conversations, services, type AgentState, type ConversationLanguage } from "../db/schema";
import { createUser } from "../auth/users";
import { completeOnboarding, createBusiness } from "../business/setup";
import { setupDentalCatalog, seedPlans } from "../db/seed";
import { createBooking } from "../booking/service";
import { getBusiness } from "../availability/loader";
import { getOrCreateConversation } from "../agent/conversations";
import { runAgentTurn } from "../agent/runner";
import { detectLanguage } from "../lib/lang";
import type { LLMMessage, LLMProvider } from "../agent/llm/types";
import { SCENARIOS, SERVICE_EN, type DayRef, type Scenario } from "./scenarios";

export type TurnResult = { user: string; reply: string; tools: string[]; failures: string[] };
export type ScenarioResult = { id: string; category: string; language: string; pass: boolean; failures: string[]; turns: TurnResult[]; ms: number };

/** Eval clock: next Monday 09:00 in Beirut (deterministic weekday semantics). */
export function evalNow(): DateTime {
  const tz = "Asia/Beirut";
  const n = DateTime.now().setZone(tz);
  return n.plus({ weeks: 1 }).startOf("week").set({ hour: 9 });
}

function dayOf(ref: DayRef, now: DateTime): string {
  const offsets: Record<DayRef, number> = { today: 0, tomorrow: 1, after_tomorrow: 2, wednesday: 2, thursday: 3, saturday: 5, next_monday: 7 };
  return now.plus({ days: offsets[ref] }).toISODate()!;
}

function isSubsequence(needle: string[], hay: string[]): boolean {
  let i = 0;
  for (const h of hay) if (h === needle[i]) i++;
  return i === needle.length;
}

export async function createEvalBusiness(): Promise<string> {
  await seedPlans();
  const tag = Math.random().toString(36).slice(2, 8);
  const owner = await withSystem((tx) => createUser(tx, { email: `eval-${tag}@fekerte.test`, password: "password123", name: "Eval Owner" }));
  const biz = await withSystem((tx) =>
    createBusiness(tx, {
      ownerUserId: owner.id,
      name: "Eval Dental Clinic",
      slug: `eval-dental-${tag}`,
      vertical: "dental",
      address: "Main Road",
      city: "Jbeil",
      phone: "+9619540123",
      planTier: "premium",
      withDefaultHours: false,
    }),
  );
  await withTenant(biz.id, async (tx) => {
    await setupDentalCatalog(tx, biz.id);
    await completeOnboarding(tx, biz.id);
  });
  return biz.id;
}

export async function runScenario(businessId: string, sc: Scenario, index: number, provider?: LLMProvider): Promise<ScenarioResult> {
  const started = Date.now();
  const now = evalNow();
  const business = await withTenant(businessId, (tx) => getBusiness(tx, businessId));
  const tz = business.timezone;
  const phone = `+96176${String(100000 + index * 37).padStart(6, "0")}`;
  const channel = sc.channel ?? "whatsapp";
  const failures: string[] = [];

  // Fixture: existing customer + appointment.
  let existingApptId: string | null = null;
  let existingStart: string | null = null;
  if (sc.existing) {
    await withTenant(businessId, async (tx) => {
      if (sc.existing!.appointment) {
        const ap = sc.existing!.appointment;
        const [svc] = (await tx.select().from(services).where(eq(services.businessId, businessId))).filter((s) => s.name.en === SERVICE_EN[ap.service]);
        const startsAt = DateTime.fromISO(`${dayOf(ap.day, now)}T${String(ap.hour).padStart(2, "0")}:00`, { zone: tz }).toJSDate();
        const appt = await createBooking(tx, businessId, {
          serviceId: svc!.id,
          startsAt,
          customer: { phone, name: sc.existing!.name },
          source: "dashboard",
          actor: { type: "system", label: "eval" },
          override: true,
          notifyCustomer: false,
          now: now.minus({ days: 1 }).toJSDate(),
        });
        existingApptId = appt.id;
        existingStart = appt.startsAt.toISOString();
      } else {
        const { upsertCustomer } = await import("../booking/service");
        await upsertCustomer(tx, businessId, { phone, name: sc.existing!.name });
      }
    });
  }

  const convo = await withTenant(businessId, (tx) => getOrCreateConversation(tx, businessId, { channel, externalId: channel === "whatsapp" ? phone : `web-${index}-${Date.now()}` }));
  let state: AgentState = {};
  let language: ConversationLanguage | null = null;
  const history: LLMMessage[] = [];
  const turns: TurnResult[] = [];
  let handoff: { urgency: string } | null = null;
  const clock = now.toJSDate();

  for (const turn of sc.turns) {
    const res = await runAgentTurn({
      business,
      conversationId: convo.id,
      channel,
      verifiedPhone: channel === "whatsapp" ? phone : null,
      history: [...history],
      userText: turn.user,
      state,
      language,
      provider,
      now: clock,
    });
    state = res.state;
    language = res.language;
    if (res.effects.handoff) handoff = res.effects.handoff;
    history.push({ role: "user", text: turn.user }, { role: "assistant", text: res.reply });
    const tools = res.toolLog.map((t) => t.name);
    const tf: string[] = [];
    if (turn.tools && !isSubsequence(turn.tools, tools)) tf.push(`expected tools ${turn.tools.join("→")} got [${tools.join(", ")}]`);
    for (const f of turn.forbid ?? []) if (tools.includes(f)) tf.push(`forbidden tool ${f} was called`);
    if (turn.lang) {
      const got = detectLanguage(res.reply, turn.lang).language;
      if (got !== turn.lang) tf.push(`reply language ${got}, expected ${turn.lang}`);
    }
    for (const inc of turn.includes ?? []) {
      const ok = typeof inc === "string" ? res.reply.includes(inc) : inc.test(res.reply);
      if (!ok) tf.push(`reply missing ${inc}`);
    }
    for (const exc of turn.excludes ?? []) {
      const bad = typeof exc === "string" ? res.reply.includes(exc) : exc.test(res.reply);
      if (bad) tf.push(`reply contains forbidden ${exc}`);
    }
    turns.push({ user: turn.user, reply: res.reply, tools, failures: tf });
    failures.push(...tf.map((f) => `turn "${turn.user.slice(0, 40)}": ${f}`));
  }

  // Outcome checks against the database.
  const created = await withTenant(businessId, (tx) =>
    tx.select().from(appointments).where(and(eq(appointments.businessId, businessId), eq(appointments.conversationId, convo.id))),
  );
  const o = sc.outcome;
  if ("booked" in o) {
    const svcRows = await withTenant(businessId, (tx) => tx.select().from(services).where(eq(services.businessId, businessId)));
    const svcId = svcRows.find((s) => s.name.en === SERVICE_EN[o.booked.service])?.id;
    const match = created.find((a) => {
      if (a.status === "cancelled" || a.serviceId !== svcId) return false;
      const local = DateTime.fromJSDate(a.startsAt).setZone(tz);
      if (o.booked.day && local.toISODate() !== dayOf(o.booked.day, now)) return false;
      if (o.booked.part === "morning" && local.hour >= 12) return false;
      if (o.booked.part === "afternoon" && (local.hour < 12 || local.hour >= 17)) return false;
      if (o.booked.hour !== undefined && local.hour !== o.booked.hour) return false;
      return true;
    });
    if (!match) {
      failures.push(
        `outcome: expected ${o.booked.service} booking ${o.booked.day ?? ""} ${o.booked.part ?? ""}${o.booked.hour ?? ""}; got ${created.map((a) => `${a.serviceId === svcId ? o.booked.service : "other"}@${DateTime.fromJSDate(a.startsAt).setZone(tz).toFormat("ccc dd HH:mm")}`).join(", ") || "none"}`,
      );
    }
  } else if ("rescheduled" in o) {
    const [a] = await withTenant(businessId, (tx) => tx.select().from(appointments).where(eq(appointments.id, existingApptId!)));
    const local = DateTime.fromJSDate(a!.startsAt).setZone(tz);
    if (a!.startsAt.toISOString() === existingStart) failures.push("outcome: appointment was not moved");
    else if (local.toISODate() !== dayOf(o.rescheduled.day, now) || (o.rescheduled.hour !== undefined && local.hour !== o.rescheduled.hour)) {
      failures.push(`outcome: moved to ${local.toFormat("ccc dd HH:mm")}, expected ${o.rescheduled.day} ${o.rescheduled.hour ?? ""}`);
    }
  } else if ("cancelled" in o) {
    const [a] = await withTenant(businessId, (tx) => tx.select().from(appointments).where(eq(appointments.id, existingApptId!)));
    if (a!.status !== "cancelled") failures.push(`outcome: appointment status ${a!.status}, expected cancelled`);
  } else if ("handoff" in o) {
    if (!handoff) failures.push("outcome: expected handoff_to_human");
    else if (o.urgent && handoff.urgency !== "urgent") failures.push("outcome: handoff should be urgent");
  } else if ("noChange" in o) {
    if (created.length) failures.push(`outcome: unexpected booking(s) created (${created.length})`);
    if (existingApptId) {
      const [a] = await withTenant(businessId, (tx) => tx.select().from(appointments).where(eq(appointments.id, existingApptId!)));
      if (a!.status === "cancelled" || a!.startsAt.toISOString() !== existingStart) failures.push("outcome: existing appointment was changed");
    }
  }
  await withTenant(businessId, (tx) => tx.update(conversations).set({ state }).where(eq(conversations.id, convo.id)));
  return { id: sc.id, category: sc.category, language: sc.language, pass: failures.length === 0, failures, turns, ms: Date.now() - started };
}

export async function runEvals(opts: { provider?: LLMProvider; filter?: (s: Scenario) => boolean; onResult?: (r: ScenarioResult) => void; voice?: boolean; idFilter?: string } = {}) {
  const businessId = await createEvalBusiness();
  const list = SCENARIOS.filter(opts.filter ?? (() => true));
  const results: ScenarioResult[] = [];
  for (const [i, sc] of list.entries()) {
    let r: ScenarioResult;
    try {
      r = await runScenario(businessId, sc, i, opts.provider);
    } catch (e) {
      r = { id: sc.id, category: sc.category, language: sc.language, pass: false, failures: [`crashed: ${e instanceof Error ? e.stack : String(e)}`], turns: [], ms: 0 };
    }
    results.push(r);
    opts.onResult?.(r);
  }
  if (opts.voice !== false) {
    const { runVoiceEvals } = await import("./voice");
    results.push(...(await runVoiceEvals(businessId, { provider: opts.provider, onResult: opts.onResult, filter: opts.idFilter ? (s) => s.id.includes(opts.idFilter!) : undefined })));
  }
  const passed = results.filter((r) => r.pass).length;
  return { businessId, results, passed, total: results.length, passRate: results.length ? passed / results.length : 0 };
}
