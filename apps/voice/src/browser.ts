/**
 * Browser call simulator WebSocket: /browser/session?token=…
 *
 * Two modes:
 *  - "text": the browser does speech recognition + speech synthesis (Web Speech
 *    API) and exchanges text turns with us. Works with zero API keys.
 *  - "audio": the browser streams 24 kHz PCM16 mic audio (binary frames); we run
 *    the real phone pipeline (realtime or cascade) and stream PCM16 back.
 *
 * Protocol (JSON text frames):
 *   → {type:"caller_text", text} | {type:"barge_in"} | {type:"hangup"}
 *   ← {type:"ready", mode, pipeline, callId, greeting} | {type:"agent_delta", text}
 *     {type:"agent_done", text, tools, booked} | {type:"caller_text"|"caller_partial", text}
 *     {type:"barge_in"} | {type:"clear"} | {type:"ended"} | {type:"error", message}
 */
import type { FastifyInstance, FastifyRequest } from "fastify";
import type { WebSocket } from "ws";
import { withTenant } from "@fekerte/core/db/tenant";
import { getBusiness } from "@fekerte/core/availability/loader";
import { logger } from "@fekerte/core/lib/logger";
import { VoiceCallSession, type VoicePipelineKind } from "@fekerte/core/voice/session";
import { verifyVoiceToken } from "@fekerte/core/voice/tokens";
import { realtimeAvailable } from "@fekerte/core/voice/realtime";
import { streamingSTTAvailable } from "@fekerte/core/voice/stt-stream";
import { SentenceChunker, toSpeakable, ttsProviderKind } from "@fekerte/core/voice/tts";
import { CascadeController, RealtimeController, type CallController } from "./controllers";

export function audioPipelineFor(pref: string | undefined): VoicePipelineKind | null {
  if (pref === "realtime" && realtimeAvailable()) return "realtime";
  if (streamingSTTAvailable() && ttsProviderKind() !== "none") return "cascade";
  if (realtimeAvailable()) return "realtime";
  return null;
}

export function registerBrowserRoutes(app: FastifyInstance) {
  app.get("/browser/capabilities", async () => ({
    audio: audioPipelineFor(process.env.VOICE_PIPELINE) !== null,
    realtime: realtimeAvailable(),
    cascade: streamingSTTAvailable() && ttsProviderKind() !== "none",
    tts: ttsProviderKind(),
  }));

  app.get("/browser/session", { websocket: true }, (socket: WebSocket, req: FastifyRequest) => {
    void handleBrowserSession(socket, req);
  });
}

async function handleBrowserSession(socket: WebSocket, req: FastifyRequest) {
  const q = req.query as { token?: string; mode?: string };
  const token = verifyVoiceToken(q.token);
  const send = (msg: Record<string, unknown>) => socket.readyState === socket.OPEN && socket.send(JSON.stringify(msg));
  if (!token) {
    send({ type: "error", message: "invalid or expired token" });
    return socket.close();
  }
  const business = await withTenant(token.businessId, (tx) => getBusiness(tx, token.businessId));
  const audioPipeline = q.mode === "audio" ? audioPipelineFor(business.aiSettings?.voicePipeline) : null;
  const pipeline: VoicePipelineKind = audioPipeline ?? "browser_text";
  const session = await VoiceCallSession.start({ business, provider: "browser", from: token.callerPhone ?? null, to: business.voiceNumber, pipeline });
  let controller: CallController | null = null;
  let turn: AbortController | null = null;
  let ended = false;

  const end = async () => {
    if (ended) return;
    ended = true;
    turn?.abort();
    await controller?.close();
    await session.end({ reason: "browser hangup", countUsage: false }).catch((err) => logger.warn("end failed", { err: String(err) }));
    send({ type: "ended", callId: session.callId });
  };

  if (audioPipeline) {
    const transport = {
      sendAudio: (audio: Buffer) => socket.readyState === socket.OPEN && socket.send(audio, { binary: true }),
      clearAudio: () => send({ type: "clear" }),
      event: (e: Record<string, unknown>) => send(e),
    };
    controller = audioPipeline === "realtime" ? new RealtimeController(session, transport, "pcm24k") : new CascadeController(session, transport, "pcm24k");
    send({ type: "ready", mode: "audio", pipeline: audioPipeline, callId: session.callId, language: session.speechLanguage });
    await controller.start();
  } else {
    const greeting = session.greeting();
    await session.logAgent(greeting);
    send({ type: "ready", mode: "text", pipeline, callId: session.callId, greeting, language: session.speechLanguage });
  }

  socket.on("message", async (raw, isBinary) => {
    if (isBinary) {
      controller?.pushAudio(Buffer.from(raw as Buffer));
      return;
    }
    let msg: { type: string; text?: string };
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return;
    }
    if (msg.type === "hangup") return end();
    if (msg.type === "barge_in") {
      turn?.abort();
      turn = null;
      return;
    }
    if (msg.type === "caller_text" && msg.text?.trim() && !audioPipeline) {
      turn?.abort();
      const ctrl = new AbortController();
      turn = ctrl;
      const chunker = new SentenceChunker((s) => !ctrl.signal.aborted && send({ type: "agent_delta", text: toSpeakable(s, session.speechLanguage) }));
      try {
        const res = await session.handleCallerText(msg.text.trim().slice(0, 500), { onDelta: (d) => chunker.push(d), signal: ctrl.signal });
        if (ctrl.signal.aborted) return;
        chunker.flush();
        send({ type: "agent_done", text: res.reply, language: session.speechLanguage, tools: res.toolLog.map((t) => t.name), booked: res.effects.bookedAppointmentIds, handoff: !!res.effects.handoff });
      } catch (err) {
        if (!ctrl.signal.aborted) {
          logger.error("browser voice turn failed", { err });
          send({ type: "error", message: "turn failed" });
        }
      } finally {
        if (turn === ctrl) turn = null;
      }
    }
  });
  socket.on("close", () => void end());
}
