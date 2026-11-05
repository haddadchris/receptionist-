/**
 * Decide who answers an incoming call: the AI, or the business first
 * (after-hours / overflow modes), and which pipeline the AI uses.
 */
import { DateTime } from "luxon";
import type { Business } from "../db/schema";
import { withTenant } from "../db/tenant";
import { loadCalendarInput } from "../availability/loader";
import { workingWindows } from "../availability/engine";
import { checkAiAllowed } from "../billing/limits";
import { aiCallAllowed } from "../agent/caps";
import { realtimeAvailable } from "./realtime";
import { streamingSTTAvailable } from "./stt-stream";
import { ttsProviderKind } from "./tts";
import type { VoicePipelineKind } from "./session";

/** Is any staff member (or the business) working right now? */
export async function isOpenNow(business: Business, now = new Date()): Promise<boolean> {
  const tz = business.timezone;
  const date = DateTime.fromJSDate(now).setZone(tz).toISODate()!;
  const input = await withTenant(business.id, (tx) => loadCalendarInput(tx, business.id, date, date));
  const windows = workingWindows(input, date);
  const t = now.getTime();
  return Object.values(windows).some((list) => list.some((w) => Date.parse(w.start) <= t && t < Date.parse(w.end)));
}

export type CallRoute =
  | { kind: "ai"; pipeline: VoicePipelineKind }
  | { kind: "ring_business"; number: string; timeout: number }
  | { kind: "unavailable"; reason: string };

/** Pipeline for phone calls: business preference, degraded gracefully to what keys allow. */
export function choosePhonePipeline(business: Business): VoicePipelineKind {
  const pref = business.aiSettings?.voicePipeline ?? (process.env.VOICE_PIPELINE as "realtime" | "cascade" | undefined) ?? "cascade";
  if (pref === "realtime" && realtimeAvailable()) return "realtime";
  if (streamingSTTAvailable() && ttsProviderKind() !== "none") return "cascade";
  if (realtimeAvailable()) return "realtime";
  return "gather"; // Twilio built-in speech recognition + <Say>; works with Twilio credentials only.
}

export async function routeIncomingCall(business: Business, opts: { afterDial?: boolean; from?: string | null } = {}): Promise<CallRoute> {
  const check = await checkAiAllowed(business, "voiceAi");
  let blocked: string | null = check.ok ? null : check.reason;
  // Same caller hammering the AI line → ring the business / voicemail instead.
  if (!blocked && !(await aiCallAllowed(business.id, opts.from))) blocked = "caller_rate_limited";
  const transfer = business.aiSettings?.transferNumber ?? business.phone ?? null;
  if (blocked) {
    return transfer ? { kind: "ring_business", number: transfer, timeout: 30 } : { kind: "unavailable", reason: blocked };
  }
  const mode = business.aiSettings?.voiceMode ?? "always";
  const ring = business.aiSettings?.overflowRingSeconds ?? 20;
  if (!opts.afterDial && transfer) {
    if (mode === "overflow") return { kind: "ring_business", number: transfer, timeout: ring };
    if (mode === "after_hours" && (await isOpenNow(business))) return { kind: "ring_business", number: transfer, timeout: ring };
  }
  return { kind: "ai", pipeline: choosePhonePipeline(business) };
}
