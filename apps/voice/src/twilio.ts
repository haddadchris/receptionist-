/**
 * Twilio voice webhooks + Media Streams WebSocket.
 *
 * Wiring (Twilio console → Phone number → Voice):
 *   "A call comes in"  → POST {VOICE_PUBLIC_URL}/twilio/voice
 *   "Call status"      → POST {VOICE_PUBLIC_URL}/twilio/status
 * The business forwards its existing Lebanese number to this Twilio number
 * (always, or on no-answer/busy for overflow) — see README "Phone setup".
 */
import type { FastifyInstance, FastifyRequest } from "fastify";
import type { WebSocket } from "ws";
import { config } from "@fekerte/core/config";
import { getBusinessByVoiceNumber } from "@fekerte/core/business/public";
import { withTenant } from "@fekerte/core/db/tenant";
import { getBusiness } from "@fekerte/core/availability/loader";
import { calls } from "@fekerte/core/db/schema";
import { normalizePhone } from "@fekerte/core/lib/phone";
import { logger } from "@fekerte/core/lib/logger";
import { VoiceCallSession } from "@fekerte/core/voice/session";
import { signValue, verifyValue } from "@fekerte/core/booking/tokens";

const STREAM_PURPOSE = "twilio-stream";
import { routeIncomingCall } from "@fekerte/core/voice/routing";
import { startRecording, transferCall, twilioConfigured, twiml, validateTwilioSignature } from "@fekerte/core/voice/twilio";
import { and, eq } from "drizzle-orm";
import { CascadeController, RealtimeController, type CallController } from "./controllers";
import { trackCall, untrackCall } from "./active";

const xml = (body: string) => ({ headers: { "content-type": "text/xml" }, body: twiml.wrap(body) });

function publicUrl(path: string) {
  return `${config.voiceUrl}${path}`;
}

function wsUrl(path: string) {
  return publicUrl(path).replace(/^http/, "ws");
}

/** Reject forged webhooks. In local dev without Twilio credentials, allow unsigned requests. */
function verified(req: FastifyRequest): boolean {
  if (!twilioConfigured()) return !config.isProduction;
  const params = (req.body ?? {}) as Record<string, string>;
  return validateTwilioSignature(publicUrl(req.url), params, req.headers["x-twilio-signature"] as string | undefined);
}

const MESSAGES = {
  notConfigured: { ar: "عذراً، هالرقم مش مفعّل.", en: "Sorry, this number is not configured.", fr: "Désolé, ce numéro n'est pas configuré." },
  noInput: { ar: "ما سمعتك منيح. فيك تعيد لو سمحت؟", en: "Sorry, I didn't catch that. Could you say it again?", fr: "Pardon, je n'ai pas bien entendu. Pouvez-vous répéter ?" },
  voicemail: { ar: "فيك تترك رسالتك بعد الصفّارة، والفريق رح يرجعلك.", en: "Please leave your message after the beep and the team will call you back.", fr: "Laissez votre message après le bip, l'équipe vous rappellera." },
  bye: { ar: "شكراً لاتصالك، مع السلامة.", en: "Thanks for calling, goodbye.", fr: "Merci de votre appel, au revoir." },
  transferring: { ar: "لحظة، عم حوّلك لحدا من الفريق.", en: "One moment, I'm connecting you to the team.", fr: "Un instant, je vous mets en relation avec l'équipe." },
} as const;

export function registerTwilioRoutes(app: FastifyInstance) {
  app.post("/twilio/voice", async (req, reply) => {
    if (!verified(req)) return reply.code(403).send("forbidden");
    const p = req.body as Record<string, string>;
    const to = normalizePhone(p.To ?? "") ?? p.To;
    const business = to ? await getBusinessByVoiceNumber(to) : null;
    if (!business) {
      const r = xml(twiml.say(MESSAGES.notConfigured.en, "en") + twiml.hangup());
      return reply.headers(r.headers).send(r.body);
    }
    const route = await routeIncomingCall(business, { from: normalizePhone(p.From ?? "") ?? p.From ?? null });
    if (route.kind === "ring_business") {
      const r = xml(twiml.dial(route.number, { timeout: route.timeout, action: publicUrl(`/twilio/after-dial?b=${business.id}`) }));
      return reply.headers(r.headers).send(r.body);
    }
    if (route.kind === "unavailable") {
      const lang = business.defaultLanguage;
      const r = xml(twiml.say(MESSAGES.voicemail[lang], lang) + twiml.record(publicUrl(`/twilio/voicemail?b=${business.id}`)));
      return reply.headers(r.headers).send(r.body);
    }
    return reply.headers({ "content-type": "text/xml" }).send(await answerWithAi(business.id, p, route.pipeline));
  });

  /** <Dial action>: the business didn't pick up (overflow / after-hours) → AI answers. */
  app.post("/twilio/after-dial", async (req, reply) => {
    if (!verified(req)) return reply.code(403).send("forbidden");
    const p = req.body as Record<string, string>;
    const businessId = (req.query as { b?: string }).b ?? "";
    if (p.DialCallStatus === "completed") return reply.headers({ "content-type": "text/xml" }).send(twiml.wrap(twiml.hangup()));
    const business = await withTenant(businessId, (tx) => getBusiness(tx, businessId));
    const route = await routeIncomingCall(business, { afterDial: true });
    if (route.kind !== "ai") return reply.headers({ "content-type": "text/xml" }).send(twiml.wrap(twiml.hangup()));
    return reply.headers({ "content-type": "text/xml" }).send(await answerWithAi(businessId, p, route.pipeline));
  });

  /** Turn-based fallback pipeline: Twilio speech recognition + <Say>. */
  app.post("/twilio/gather", async (req, reply) => {
    if (!verified(req)) return reply.code(403).send("forbidden");
    const q = req.query as { b: string; c: string; e?: string };
    const p = req.body as Record<string, string>;
    const session = await VoiceCallSession.load(q.b, q.c);
    if (!session) return reply.headers({ "content-type": "text/xml" }).send(twiml.wrap(twiml.hangup()));
    const lang = session.speechLanguage;
    const speech = (p.SpeechResult ?? "").trim();
    const empties = Number(q.e ?? 0);
    const action = (e: number) => publicUrl(`/twilio/gather?b=${q.b}&c=${q.c}&e=${e}`);
    if (!speech) {
      if (empties >= 1) {
        const r = xml(twiml.say(MESSAGES.voicemail[lang], lang) + twiml.record(publicUrl(`/twilio/voicemail?b=${q.b}&c=${q.c}`)));
        return reply.headers(r.headers).send(r.body);
      }
      const r = xml(twiml.gather(action(empties + 1), lang, twiml.say(MESSAGES.noInput[lang], lang)));
      return reply.headers(r.headers).send(r.body);
    }
    const res = await session.handleCallerText(speech);
    const transferTo = session.business.aiSettings?.transferNumber;
    if (res.effects.handoff && transferTo) {
      const r = xml(twiml.say(res.reply, session.speechLanguage) + twiml.say(MESSAGES.transferring[lang], lang) + twiml.dial(transferTo, { timeout: 25 }));
      return reply.headers(r.headers).send(r.body);
    }
    const r = xml(twiml.gather(action(0), session.speechLanguage, twiml.say(res.reply, session.speechLanguage)) + twiml.redirect(action(1)));
    return reply.headers(r.headers).send(r.body);
  });

  app.post("/twilio/voicemail", async (req, reply) => {
    if (!verified(req)) return reply.code(403).send("forbidden");
    const q = req.query as { b: string; c?: string };
    const p = req.body as Record<string, string>;
    if (q.c && p.RecordingUrl) {
      await withTenant(q.b, (tx) => tx.update(calls).set({ recordingUrl: p.RecordingUrl }).where(and(eq(calls.businessId, q.b), eq(calls.id, q.c!))));
      const session = await VoiceCallSession.load(q.b, q.c);
      await session?.logAgent("📞 Voicemail recorded");
    }
    return reply.headers({ "content-type": "text/xml" }).send(twiml.wrap(twiml.say(MESSAGES.bye.ar, "ar") + twiml.hangup()));
  });

  app.post("/twilio/recording", async (req, reply) => {
    if (!verified(req)) return reply.code(403).send("forbidden");
    const q = req.query as { b: string; c: string };
    const p = req.body as Record<string, string>;
    if (p.RecordingUrl) await withTenant(q.b, (tx) => tx.update(calls).set({ recordingUrl: p.RecordingUrl }).where(and(eq(calls.businessId, q.b), eq(calls.id, q.c))));
    return reply.send({ ok: true });
  });

  /** Call status callback: finalize calls (gather path; stream path also ends on "stop"). */
  app.post("/twilio/status", async (req, reply) => {
    if (!verified(req)) return reply.code(403).send("forbidden");
    const p = req.body as Record<string, string>;
    if (["completed", "busy", "failed", "no-answer", "canceled"].includes(p.CallStatus ?? "")) {
      const row = await findCallBySid(p.CallSid ?? "");
      if (row) {
        const session = await VoiceCallSession.load(row.businessId, row.id);
        await session?.end({ reason: p.CallStatus });
      }
    }
    return reply.send({ ok: true });
  });

  app.get("/twilio/stream", { websocket: true }, (socket: WebSocket) => handleMediaStream(socket));
}

async function findCallBySid(callSid: string) {
  if (!callSid) return null;
  const { withSystem } = await import("@fekerte/core/db/tenant");
  const [row] = await withSystem((tx) => tx.select({ id: calls.id, businessId: calls.businessId }).from(calls).where(eq(calls.providerCallId, callSid)));
  return row ?? null;
}

async function answerWithAi(businessId: string, p: Record<string, string>, pipeline: "realtime" | "cascade" | "gather" | "browser_text"): Promise<string> {
  const business = await withTenant(businessId, (tx) => getBusiness(tx, businessId));
  const session = await VoiceCallSession.start({ business, provider: "twilio", providerCallId: p.CallSid, from: p.From, to: p.To, pipeline });
  if (pipeline === "gather") {
    const greeting = session.greeting();
    await session.logAgent(greeting);
    if (p.CallSid) void startRecording(p.CallSid, publicUrl(`/twilio/recording?b=${businessId}&c=${session.callId}`));
    const action = publicUrl(`/twilio/gather?b=${businessId}&c=${session.callId}&e=0`);
    return twiml.wrap(twiml.gather(action, session.speechLanguage, twiml.say(greeting, session.speechLanguage)) + twiml.redirect(action));
  }
  // Signed so only media streams started by our own TwiML can attach to a call session.
  const sig = signValue(`${businessId}:${session.callId}`, STREAM_PURPOSE);
  return twiml.wrap(twiml.stream(wsUrl("/twilio/stream"), { businessId, callId: session.callId, pipeline, sig }));
}

/** Twilio Media Streams protocol: connected → start → media… → stop. 8 kHz µ-law, base64. */
function handleMediaStream(socket: WebSocket) {
  let streamSid = "";
  let callSid = "";
  let session: VoiceCallSession | null = null;
  let controller: CallController | null = null;
  let marks = 0;
  const waiters = new Map<string, () => void>();
  let transferred = false;

  const send = (msg: object) => socket.readyState === socket.OPEN && socket.send(JSON.stringify(msg));
  const transport = {
    sendAudio: (audio: Buffer) => {
      for (let i = 0; i < audio.length; i += 160) send({ event: "media", streamSid, media: { payload: audio.subarray(i, i + 160).toString("base64") } });
    },
    clearAudio: () => send({ event: "clear", streamSid }),
    waitForPlayback: () =>
      new Promise<void>((resolve) => {
        const name = `m${++marks}`;
        waiters.set(name, resolve);
        send({ event: "mark", streamSid, mark: { name } });
        setTimeout(() => waiters.get(name)?.(), 15000);
      }),
  };

  socket.on("message", async (raw) => {
    let msg: { event: string; start?: { streamSid: string; callSid: string; customParameters?: Record<string, string> }; media?: { payload: string }; mark?: { name: string } };
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return;
    }
    try {
      switch (msg.event) {
        case "start": {
          streamSid = msg.start!.streamSid;
          callSid = msg.start!.callSid;
          const params = msg.start!.customParameters ?? {};
          if (!params.sig || verifyValue(params.sig, STREAM_PURPOSE) !== `${params.businessId}:${params.callId}`) {
            logger.warn("rejected unsigned media stream", { callSid });
            return socket.close();
          }
          session = await VoiceCallSession.load(params.businessId!, params.callId!);
          if (!session) return socket.close();
          trackCall(session.callId);
          void startRecording(callSid, publicUrl(`/twilio/recording?b=${params.businessId}&c=${params.callId}`));
          controller = params.pipeline === "realtime" ? new RealtimeController(session, transport, "ulaw8k") : new CascadeController(session, transport, "ulaw8k");
          controller.onHandoff = async () => {
            const to = session?.business.aiSettings?.transferNumber;
            if (to && callSid) transferred = await transferCall(callSid, to);
          };
          await controller.start();
          break;
        }
        case "media":
          if (msg.media?.payload) controller?.pushAudio(Buffer.from(msg.media.payload, "base64"));
          break;
        case "mark": {
          const w = waiters.get(msg.mark?.name ?? "");
          if (w) {
            waiters.delete(msg.mark!.name);
            w();
          }
          break;
        }
        case "stop":
          if (session) untrackCall(session.callId);
          await controller?.close();
          await session?.end({ reason: "stream stopped", transferred });
          break;
      }
    } catch (err) {
      logger.error("media stream error", { err });
    }
  });
  socket.on("close", async () => {
    if (session) untrackCall(session.callId);
    await controller?.close();
    await session?.end({ reason: "socket closed", transferred }).catch(() => {});
  });
}
