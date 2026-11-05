/**
 * Twilio telephony helpers: webhook signature validation, TwiML builders and
 * REST calls (transfer, recording). Env: TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN.
 * Written from Twilio's documented, long-stable interfaces (Media Streams,
 * <Connect><Stream>, <Dial>, <Gather input="speech">, Calls/Recordings REST).
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import { logger } from "../lib/logger";

export function twilioConfigured(): boolean {
  return !!(process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN);
}

/** X-Twilio-Signature = base64(HMAC-SHA1(authToken, fullUrl + Σ sorted(key+value))). */
export function validateTwilioSignature(url: string, params: Record<string, string>, signature: string | undefined, authToken = process.env.TWILIO_AUTH_TOKEN ?? ""): boolean {
  if (!authToken || !signature) return false;
  const data = url + Object.keys(params).sort().map((k) => k + params[k]).join("");
  const expected = createHmac("sha1", authToken).update(Buffer.from(data, "utf8")).digest("base64");
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export const twiml = {
  wrap: (inner: string) => `<?xml version="1.0" encoding="UTF-8"?><Response>${inner}</Response>`,
  stream: (wsUrl: string, params: Record<string, string>) =>
    `<Connect><Stream url="${esc(wsUrl)}">${Object.entries(params)
      .map(([k, v]) => `<Parameter name="${esc(k)}" value="${esc(v)}"/>`)
      .join("")}</Stream></Connect>`,
  dial: (number: string, opts: { timeout?: number; action?: string; callerId?: string } = {}) =>
    `<Dial answerOnBridge="true"${opts.timeout ? ` timeout="${opts.timeout}"` : ""}${opts.action ? ` action="${esc(opts.action)}" method="POST"` : ""}${opts.callerId ? ` callerId="${esc(opts.callerId)}"` : ""}>${esc(number)}</Dial>`,
  say: (text: string, lang: "ar" | "en" | "fr") => {
    const voice = lang === "ar" ? (process.env.TWILIO_SAY_VOICE_AR ?? "Polly.Zeina") : lang === "fr" ? (process.env.TWILIO_SAY_VOICE_FR ?? "Polly.Lea") : (process.env.TWILIO_SAY_VOICE_EN ?? "Polly.Joanna");
    const language = lang === "ar" ? "arb" : lang === "fr" ? "fr-FR" : "en-US";
    return `<Say voice="${voice}" language="${language}">${esc(text)}</Say>`;
  },
  /** Speech gather; Lebanese Arabic recognition with English/French hints. */
  gather: (action: string, lang: "ar" | "en" | "fr", inner = "") =>
    `<Gather input="speech" action="${esc(action)}" method="POST" speechTimeout="auto" language="${lang === "ar" ? "ar-LB" : lang === "fr" ? "fr-FR" : "en-US"}" actionOnEmptyResult="true">${inner}</Gather>`,
  record: (action: string, maxLength = 90) => `<Record action="${esc(action)}" maxLength="${maxLength}" playBeep="true" trim="trim-silence"/>`,
  hangup: () => `<Hangup/>`,
  redirect: (url: string) => `<Redirect method="POST">${esc(url)}</Redirect>`,
  pause: (s: number) => `<Pause length="${s}"/>`,
};

async function twilioRest(path: string, form: Record<string, string>) {
  const sid = process.env.TWILIO_ACCOUNT_SID!;
  const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}${path}`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${Buffer.from(`${sid}:${process.env.TWILIO_AUTH_TOKEN}`).toString("base64")}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams(form),
  });
  if (!res.ok) throw new Error(`Twilio REST ${path} → ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return res.json();
}

/** Redirect a live call to a human (used on handoff). */
export async function transferCall(callSid: string, toNumber: string): Promise<boolean> {
  if (!twilioConfigured()) return false;
  try {
    await twilioRest(`/Calls/${callSid}.json`, { Twiml: twiml.wrap(twiml.dial(toNumber, { timeout: 25 })) });
    return true;
  } catch (err) {
    logger.error("twilio transfer failed", { err });
    return false;
  }
}

/** Start recording a call in progress (status callback stores the URL). */
export async function startRecording(callSid: string, statusCallback: string): Promise<void> {
  if (!twilioConfigured() || process.env.TWILIO_RECORD_CALLS === "false") return;
  try {
    await twilioRest(`/Calls/${callSid}/Recordings.json`, { RecordingStatusCallback: statusCallback, RecordingStatusCallbackMethod: "POST", RecordingChannels: "dual" });
  } catch (err) {
    logger.warn("twilio start recording failed", { err: String(err) });
  }
}

/** Fetch a recording (for the dashboard proxy; Twilio recordings need auth). */
export async function fetchRecording(recordingUrl: string): Promise<Response> {
  const sid = process.env.TWILIO_ACCOUNT_SID ?? "";
  const url = recordingUrl.endsWith(".mp3") || recordingUrl.endsWith(".wav") ? recordingUrl : `${recordingUrl}.mp3`;
  return fetch(url, { headers: { Authorization: `Basic ${Buffer.from(`${sid}:${process.env.TWILIO_AUTH_TOKEN ?? ""}`).toString("base64")}` } });
}
