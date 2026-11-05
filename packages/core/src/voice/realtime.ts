/**
 * Pipeline A — speech-to-speech with the OpenAI Realtime API (lowest latency).
 * The model hears the caller and speaks directly; it calls OUR tools (same
 * definitions and executors as WhatsApp/web chat) through function calling.
 *
 * Env: OPENAI_API_KEY, OPENAI_REALTIME_MODEL (default gpt-realtime),
 * OPENAI_REALTIME_VOICE (default marin), OPENAI_REALTIME_URL.
 * Event/session shapes verified against the openai npm package's GA realtime types.
 */
import WebSocket from "ws";
import { logger } from "../lib/logger";
import { TOOL_DEFS } from "../agent/tools";
import { buildDynamicPrompt, buildStablePrompt } from "../agent/prompt";
import { loadPromptData } from "../agent/runner";
import { LEBANESE_STT_PROMPT } from "../providers/stt";
import type { VoiceCallSession } from "./session";

export function realtimeAvailable(): boolean {
  return !!process.env.OPENAI_API_KEY;
}

export type RealtimeBridge = {
  push(audio: Buffer): void;
  close(): void;
};

export async function openRealtimeAgent(input: {
  session: VoiceCallSession;
  format: "ulaw8k" | "pcm24k";
  onAudio: (audio: Buffer) => void;
  onSpeechStarted: () => void;
  onAgentText?: (text: string) => void;
  onCallerText?: (text: string) => void;
  onHandoff?: (reason: string) => void;
  onError?: (err: Error) => void;
}): Promise<RealtimeBridge> {
  const s = input.session;
  const data = await loadPromptData(s.business);
  const instructions = [
    buildStablePrompt({ business: s.business, ...data, channel: "voice" }),
    buildDynamicPrompt({
      business: s.business,
      now: new Date(),
      channel: "voice",
      language: s.language,
      mixed: false,
      customer: { name: null, known: false, phoneVerified: !!s.callerPhone },
      state: s.state,
    }),
    `Start the call by saying exactly: "${s.greeting()}"`,
  ].join("\n\n");

  const model = process.env.OPENAI_REALTIME_MODEL ?? "gpt-realtime";
  const ws = new WebSocket(`${process.env.OPENAI_REALTIME_URL ?? "wss://api.openai.com/v1/realtime"}?model=${encodeURIComponent(model)}`, {
    headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
  });
  const fmt = input.format === "ulaw8k" ? { type: "audio/pcmu" } : { type: "audio/pcm", rate: 24000 };
  const pending: Buffer[] = [];
  let ready = false;
  let agentText = "";

  ws.on("open", () => {
    ws.send(
      JSON.stringify({
        type: "session.update",
        session: {
          type: "realtime",
          model,
          instructions,
          output_modalities: ["audio"],
          audio: {
            input: {
              format: fmt,
              noise_reduction: { type: "near_field" },
              transcription: { model: process.env.OPENAI_STT_MODEL ?? "gpt-4o-transcribe", prompt: LEBANESE_STT_PROMPT },
              turn_detection: { type: "semantic_vad", eagerness: "auto", create_response: true, interrupt_response: true },
            },
            output: { format: fmt, voice: process.env.OPENAI_REALTIME_VOICE ?? "marin" },
          },
          tools: TOOL_DEFS.map((t) => ({ type: "function", name: t.name, description: t.description, parameters: t.inputSchema })),
          tool_choice: "auto",
        },
      }),
    );
  });

  ws.on("message", async (raw) => {
    let ev: Record<string, unknown> & { type: string };
    try {
      ev = JSON.parse(raw.toString());
    } catch {
      return;
    }
    switch (ev.type) {
      case "session.updated":
        if (!ready) {
          ready = true;
          for (const b of pending.splice(0)) ws.send(JSON.stringify({ type: "input_audio_buffer.append", audio: b.toString("base64") }));
          ws.send(JSON.stringify({ type: "response.create" })); // greeting
        }
        break;
      case "response.output_audio.delta":
        input.onAudio(Buffer.from(String(ev.delta), "base64"));
        break;
      case "response.output_audio_transcript.delta":
        agentText += String(ev.delta ?? "");
        break;
      case "response.output_audio_transcript.done": {
        const text = String(ev.transcript ?? agentText).trim();
        agentText = "";
        if (text) {
          input.onAgentText?.(text);
          await s.logAgent(text).catch(() => {});
        }
        break;
      }
      case "input_audio_buffer.speech_started":
        input.onSpeechStarted();
        break;
      case "conversation.item.input_audio_transcription.completed": {
        const text = String(ev.transcript ?? "").trim();
        if (text) {
          input.onCallerText?.(text);
          await s.logCaller(text).catch(() => {});
        }
        break;
      }
      case "response.function_call_arguments.done": {
        const name = String(ev.name);
        let args: unknown = {};
        try {
          args = JSON.parse(String(ev.arguments || "{}"));
        } catch {
          args = {};
        }
        let output: string;
        try {
          output = await s.executeVoiceTool(name, args);
        } catch (err) {
          logger.error("realtime tool failed", { err, name });
          output = JSON.stringify({ error: "tool_failed" });
        }
        ws.send(JSON.stringify({ type: "conversation.item.create", item: { type: "function_call_output", call_id: ev.call_id, output } }));
        ws.send(JSON.stringify({ type: "response.create" }));
        if (name === "handoff_to_human") input.onHandoff?.(String((args as { reason?: string }).reason ?? "handoff"));
        break;
      }
      case "error":
        logger.warn("realtime error", { error: ev.error });
        input.onError?.(new Error(JSON.stringify(ev.error)));
        break;
    }
  });
  ws.on("error", (err) => input.onError?.(err));

  return {
    push(audio) {
      if (!ready) pending.push(audio);
      else if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: "input_audio_buffer.append", audio: audio.toString("base64") }));
    },
    close() {
      try {
        ws.close();
      } catch {
        // ignore
      }
    },
  };
}
