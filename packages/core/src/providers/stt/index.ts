/**
 * Speech-to-text adapter (WhatsApp voice notes; voice cascade in Phase 3 uses
 * the streaming variant in apps/voice).
 *
 * STT_PROVIDER = mock | openai (any OpenAI-compatible /audio/transcriptions
 * endpoint: OpenAI, Groq…). STT_MODEL defaults to "gpt-4o-transcribe".
 */
import { logger } from "../../lib/logger";

export interface STTProvider {
  readonly name: string;
  /** Returns null when transcription isn't available. */
  transcribe(audio: Buffer, mimeType: string, opts?: { languageHint?: "ar" | "en" | "fr"; prompt?: string }): Promise<string | null>;
}

export class MockSTTProvider implements STTProvider {
  readonly name = "mock";
  async transcribe(): Promise<string | null> {
    return null;
  }
}

/** Lebanese context prompt improves dialect/code-switching recognition. */
export const LEBANESE_STT_PROMPT =
  "Lebanese Arabic phone/WhatsApp conversation with a clinic receptionist. Speakers mix Lebanese Arabic, English and French. Words: maw3ad, badde, bukra, ba3d el dohr, tanzif, fa7es, rendez-vous.";

export class OpenAISTTProvider implements STTProvider {
  readonly name = "openai";
  private base = (process.env.STT_BASE_URL ?? process.env.OPENAI_BASE_URL ?? "https://api.openai.com/v1").replace(/\/$/, "");
  private key = process.env.STT_API_KEY ?? process.env.OPENAI_API_KEY ?? "";
  private model = process.env.STT_MODEL ?? "gpt-4o-transcribe";

  async transcribe(audio: Buffer, mimeType: string, opts: { languageHint?: "ar" | "en" | "fr"; prompt?: string } = {}): Promise<string | null> {
    const ext = mimeType.includes("ogg") ? "ogg" : mimeType.includes("mpeg") ? "mp3" : mimeType.includes("wav") ? "wav" : mimeType.includes("webm") ? "webm" : "m4a";
    const form = new FormData();
    form.append("file", new Blob([new Uint8Array(audio)], { type: mimeType }), `audio.${ext}`);
    form.append("model", this.model);
    form.append("prompt", opts.prompt ?? LEBANESE_STT_PROMPT);
    // No forced language: Lebanese speakers code-switch; let the model detect.
    const res = await fetch(`${this.base}/audio/transcriptions`, { method: "POST", headers: { Authorization: `Bearer ${this.key}` }, body: form });
    if (!res.ok) {
      logger.warn("stt failed", { status: res.status, body: (await res.text()).slice(0, 200) });
      return null;
    }
    const data = (await res.json()) as { text?: string };
    return data.text?.trim() || null;
  }
}

const g = globalThis as unknown as { __fkSTT?: STTProvider };

export function getSTTProvider(): STTProvider {
  if (!g.__fkSTT) g.__fkSTT = process.env.STT_PROVIDER === "openai" ? new OpenAISTTProvider() : new MockSTTProvider();
  return g.__fkSTT;
}

export function setSTTProvider(p: STTProvider) {
  g.__fkSTT = p;
}
