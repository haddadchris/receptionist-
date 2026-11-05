/**
 * Text-to-speech adapters (streaming). Output formats:
 *  - "ulaw8k": 8 kHz µ-law (Twilio)
 *  - "pcm24k": 24 kHz PCM16 little-endian (browser simulator)
 *
 * TTS_PROVIDER = elevenlabs | openai | none
 *  - ElevenLabs: best Arabic dialect quality. ELEVENLABS_API_KEY,
 *    ELEVENLABS_VOICE_ID (pick a Levantine/Lebanese voice in the Voice Library),
 *    ELEVENLABS_MODEL (default eleven_flash_v2_5 for low latency; eleven_multilingual_v2 for quality).
 *  - OpenAI: OPENAI_API_KEY, OPENAI_TTS_MODEL (default gpt-4o-mini-tts), OPENAI_TTS_VOICE.
 * Endpoints are written from the vendors' documented REST shapes; verify when going live.
 */
import { logger } from "../lib/logger";
import { bufferToInt16, int16ToBuffer, pcm16ToMulaw, resample } from "./audio";

export type TTSFormat = "ulaw8k" | "pcm24k";

export interface TTSProvider {
  readonly name: string;
  /** Stream audio for `text`; resolves when done. Honour `signal` for barge-in. */
  stream(text: string, opts: { language: "ar" | "en" | "fr"; format: TTSFormat; signal?: AbortSignal }, onChunk: (audio: Buffer) => void): Promise<void>;
}

export class NoTTS implements TTSProvider {
  readonly name = "none";
  async stream(): Promise<void> {}
}

export class ElevenLabsTTS implements TTSProvider {
  readonly name = "elevenlabs";
  private key = process.env.ELEVENLABS_API_KEY ?? "";
  private voice = process.env.ELEVENLABS_VOICE_ID ?? "";
  private model = process.env.ELEVENLABS_MODEL ?? "eleven_flash_v2_5";

  async stream(text: string, opts: { language: "ar" | "en" | "fr"; format: TTSFormat; signal?: AbortSignal }, onChunk: (audio: Buffer) => void) {
    const outputFormat = opts.format === "ulaw8k" ? "ulaw_8000" : "pcm_24000";
    const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${this.voice}/stream?output_format=${outputFormat}`, {
      method: "POST",
      signal: opts.signal,
      headers: { "xi-api-key": this.key, "Content-Type": "application/json", Accept: "audio/*" },
      body: JSON.stringify({
        text,
        model_id: this.model,
        language_code: opts.language,
        voice_settings: { stability: 0.45, similarity_boost: 0.8, speed: 1.0 },
      }),
    });
    if (!res.ok || !res.body) throw new Error(`ElevenLabs TTS ${res.status}: ${(await res.text().catch(() => "")).slice(0, 200)}`);
    const reader = res.body.getReader();
    let carry: Buffer = Buffer.alloc(0);
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      let chunk: Buffer = Buffer.from(value);
      if (opts.format === "pcm24k") {
        // Keep PCM16 sample alignment across network chunks.
        chunk = Buffer.concat([carry, chunk]);
        const even = chunk.length - (chunk.length % 2);
        carry = chunk.subarray(even);
        chunk = chunk.subarray(0, even);
      }
      if (chunk.length) onChunk(chunk);
    }
  }
}

export class OpenAITTS implements TTSProvider {
  readonly name = "openai";
  private key = process.env.OPENAI_API_KEY ?? "";
  private base = (process.env.OPENAI_BASE_URL ?? "https://api.openai.com/v1").replace(/\/$/, "");
  private model = process.env.OPENAI_TTS_MODEL ?? "gpt-4o-mini-tts";
  private voice = process.env.OPENAI_TTS_VOICE ?? "coral";

  async stream(text: string, opts: { language: "ar" | "en" | "fr"; format: TTSFormat; signal?: AbortSignal }, onChunk: (audio: Buffer) => void) {
    const instructions =
      opts.language === "ar"
        ? "Speak in a warm Lebanese Arabic (Levantine) accent, like a friendly clinic receptionist in Beirut. Natural pace."
        : opts.language === "fr"
          ? "Parlez avec un accent libanais francophone, chaleureux et naturel."
          : "Warm, friendly receptionist with a light Lebanese accent. Natural pace.";
    const res = await fetch(`${this.base}/audio/speech`, {
      method: "POST",
      signal: opts.signal,
      headers: { Authorization: `Bearer ${this.key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: this.model, voice: this.voice, input: text, instructions, response_format: "pcm" }),
    });
    if (!res.ok || !res.body) throw new Error(`OpenAI TTS ${res.status}`);
    const reader = res.body.getReader();
    let carry: Buffer = Buffer.alloc(0);
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      const joined = Buffer.concat([carry, Buffer.from(value)]);
      const even = joined.length - (joined.length % 2);
      carry = joined.subarray(even);
      const pcm24 = bufferToInt16(joined.subarray(0, even));
      if (!pcm24.length) continue;
      onChunk(opts.format === "ulaw8k" ? pcm16ToMulaw(resample(pcm24, 24000, 8000)) : int16ToBuffer(pcm24));
    }
  }
}

export function ttsProviderKind(): "elevenlabs" | "openai" | "none" {
  const k = process.env.TTS_PROVIDER;
  if (k === "elevenlabs" || k === "openai" || k === "none") return k;
  if (process.env.ELEVENLABS_API_KEY && process.env.ELEVENLABS_VOICE_ID) return "elevenlabs";
  if (process.env.OPENAI_API_KEY) return "openai";
  return "none";
}

export function getTTSProvider(): TTSProvider {
  const kind = ttsProviderKind();
  if (kind === "elevenlabs") return new ElevenLabsTTS();
  if (kind === "openai") return new OpenAITTS();
  return new NoTTS();
}

/**
 * Make text speakable: no emojis/URLs/list markers, prices and times read
 * naturally. Applied to every voice reply (real LLMs and the mock).
 */
export function toSpeakable(text: string, language: "ar" | "en" | "fr"): string {
  let t = text
    .replace(/https?:\/\/\S+/g, "")
    .replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}\u{200D}]/gu, "")
    .replace(/^\s*(?:[-•*]|\d+[.)])\s+/gm, "")
    .replace(/\s*\n+\s*/g, language === "ar" ? "، " : ", ")
    .replace(/\s{2,}/g, " ");
  t = t.replace(/\$(\d+(?:\.\d+)?)\+?/g, (_, n: string) => (language === "ar" ? `${n} دولار` : `${n} dollars`));
  t = t.replace(/\bDr\.\s*/g, language === "ar" ? "الدكتور " : language === "fr" ? "docteur " : "Doctor ");
  return t.replace(/[،,]\s*[،,]/g, language === "ar" ? "،" : ",").trim();
}

/** Split streamed LLM text into speakable sentences as early as possible (lower latency). */
export class SentenceChunker {
  private buf = "";
  constructor(private readonly emit: (sentence: string) => void) {}
  push(delta: string) {
    this.buf += delta;
    for (;;) {
      // First sentence boundary (followed by whitespace) whose sentence is long enough to speak.
      const re = /[.!?؟،\n](\s+)/g;
      let cut = -1;
      let m: RegExpExecArray | null;
      while ((m = re.exec(this.buf))) {
        const end = m.index + 1;
        if (this.buf.slice(0, end).trim().length >= 12) {
          cut = end;
          break;
        }
      }
      if (cut === -1) {
        // Force a cut on very long runs without punctuation.
        if (this.buf.length > 220) {
          const sp = this.buf.lastIndexOf(" ", 200);
          if (sp > 40) {
            this.emit(this.buf.slice(0, sp).trim());
            this.buf = this.buf.slice(sp);
            continue;
          }
        }
        break;
      }
      this.emit(this.buf.slice(0, cut).trim());
      this.buf = this.buf.slice(cut).replace(/^\s+/, "");
    }
  }
  flush() {
    const rest = this.buf.trim();
    this.buf = "";
    if (rest) this.emit(rest);
  }
}

export function logTTSFailure(err: unknown) {
  logger.warn("tts failed", { err: err instanceof Error ? err.message : String(err) });
}
