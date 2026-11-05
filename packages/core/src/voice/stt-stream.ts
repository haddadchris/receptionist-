/**
 * Streaming speech-to-text for the cascade pipeline, via an OpenAI Realtime
 * *transcription* session (server VAD, multi-language for Lebanese
 * code-switching). Input: 8 kHz µ-law (Twilio) or 24 kHz PCM16 (browser).
 *
 * Env: OPENAI_API_KEY, OPENAI_STT_MODEL (default gpt-4o-transcribe),
 * OPENAI_REALTIME_URL (default wss://api.openai.com/v1/realtime).
 * Event names verified against the openai npm package's realtime types.
 */
import WebSocket from "ws";
import { logger } from "../lib/logger";
import { LEBANESE_STT_PROMPT } from "../providers/stt";

export type StreamingSTTEvents = {
  onSpeechStarted: () => void;
  onFinal: (text: string) => void;
  onPartial?: (text: string) => void;
  onError?: (err: Error) => void;
};

export interface StreamingSTT {
  push(audio: Buffer): void;
  close(): void;
}

export function streamingSTTAvailable(): boolean {
  return !!process.env.OPENAI_API_KEY;
}

export function openStreamingSTT(input: { format: "ulaw8k" | "pcm24k"; events: StreamingSTTEvents }): StreamingSTT {
  const url = `${process.env.OPENAI_REALTIME_URL ?? "wss://api.openai.com/v1/realtime"}?intent=transcription`;
  const ws = new WebSocket(url, { headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` } });
  const queue: Buffer[] = [];
  let open = false;
  let partial = "";

  ws.on("open", () => {
    open = true;
    ws.send(
      JSON.stringify({
        type: "session.update",
        session: {
          type: "transcription",
          audio: {
            input: {
              format: input.format === "ulaw8k" ? { type: "audio/pcmu" } : { type: "audio/pcm", rate: 24000 },
              noise_reduction: { type: "near_field" },
              transcription: {
                model: process.env.OPENAI_STT_MODEL ?? "gpt-4o-transcribe",
                prompt: LEBANESE_STT_PROMPT,
                languages: ["ar", "en", "fr"],
              },
              turn_detection: { type: "server_vad", silence_duration_ms: Number(process.env.VOICE_SILENCE_MS ?? 550), threshold: 0.5 },
            },
          },
        },
      }),
    );
    for (const b of queue.splice(0)) ws.send(JSON.stringify({ type: "input_audio_buffer.append", audio: b.toString("base64") }));
  });
  ws.on("message", (raw) => {
    let ev: { type: string; transcript?: string; delta?: string; error?: { message?: string } };
    try {
      ev = JSON.parse(raw.toString());
    } catch {
      return;
    }
    switch (ev.type) {
      case "input_audio_buffer.speech_started":
        partial = "";
        input.events.onSpeechStarted();
        break;
      case "conversation.item.input_audio_transcription.delta":
        partial += ev.delta ?? "";
        input.events.onPartial?.(partial);
        break;
      case "conversation.item.input_audio_transcription.completed":
        partial = "";
        if (ev.transcript?.trim()) input.events.onFinal(ev.transcript.trim());
        break;
      case "error":
        logger.warn("stt stream error", { error: ev.error?.message });
        input.events.onError?.(new Error(ev.error?.message ?? "stt error"));
        break;
    }
  });
  ws.on("error", (err) => input.events.onError?.(err));

  return {
    push(audio: Buffer) {
      if (!open) {
        queue.push(audio);
        return;
      }
      if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: "input_audio_buffer.append", audio: audio.toString("base64") }));
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
