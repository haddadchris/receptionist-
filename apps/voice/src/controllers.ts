/**
 * Audio call controllers, transport-agnostic (Twilio Media Streams or the
 * browser simulator). They connect a VoiceCallSession to a pipeline:
 *
 *  - CascadeController: streaming STT → agent (streamed text) → sentence TTS.
 *    Barge-in: when the caller starts speaking we clear queued audio and abort
 *    the in-flight LLM/TTS work.
 *  - RealtimeController: OpenAI Realtime speech-to-speech; our tools are
 *    executed through the session.
 */
import { logger } from "@fekerte/core/lib/logger";
import type { VoiceCallSession } from "@fekerte/core/voice/session";
import { getTTSProvider, logTTSFailure, SentenceChunker, toSpeakable, type TTSFormat } from "@fekerte/core/voice/tts";
import { openStreamingSTT, type StreamingSTT } from "@fekerte/core/voice/stt-stream";
import { openRealtimeAgent, type RealtimeBridge } from "@fekerte/core/voice/realtime";

export interface AudioTransport {
  sendAudio(audio: Buffer): void;
  /** Drop audio already queued on the far end (barge-in). */
  clearAudio(): void;
  /** Resolves when everything sent so far has been played (Twilio marks). */
  waitForPlayback?(): Promise<void>;
  event?(e: Record<string, unknown>): void;
}

export interface CallController {
  start(): Promise<void>;
  pushAudio(audio: Buffer): void;
  close(): Promise<void>;
  /** Set when the agent handed off and a human should take the call. */
  onHandoff?: (reason: string) => void;
}

export class CascadeController implements CallController {
  private stt: StreamingSTT | null = null;
  private turn: AbortController | null = null;
  private speaking = false;
  private ttsChain: Promise<void> = Promise.resolve();
  onHandoff?: (reason: string) => void;

  constructor(
    private readonly session: VoiceCallSession,
    private readonly transport: AudioTransport,
    private readonly format: TTSFormat,
  ) {}

  async start() {
    this.stt = openStreamingSTT({
      format: this.format,
      events: {
        onSpeechStarted: () => this.bargeIn(),
        onPartial: (text) => this.transport.event?.({ type: "caller_partial", text }),
        onFinal: (text) => void this.onUtterance(text),
        onError: (err) => logger.warn("stt error", { err: err.message }),
      },
    });
    const greeting = this.session.greeting();
    await this.session.logAgent(greeting);
    this.transport.event?.({ type: "agent_done", text: greeting });
    this.say(greeting, new AbortController().signal);
  }

  pushAudio(audio: Buffer) {
    this.stt?.push(audio);
  }

  private bargeIn() {
    if (this.speaking || this.turn) {
      this.transport.clearAudio();
      this.turn?.abort();
      this.turn = null;
      this.speaking = false;
      this.ttsChain = Promise.resolve();
      this.transport.event?.({ type: "barge_in" });
    }
  }

  /** Queue one sentence of TTS (sequential, abortable). */
  private say(sentence: string, signal: AbortSignal) {
    const text = toSpeakable(sentence, this.session.speechLanguage);
    if (!text) return;
    const tts = getTTSProvider();
    this.ttsChain = this.ttsChain.then(async () => {
      if (signal.aborted) return;
      this.speaking = true;
      try {
        await tts.stream(text, { language: this.session.speechLanguage, format: this.format, signal }, (chunk) => {
          if (!signal.aborted) this.transport.sendAudio(chunk);
        });
      } catch (err) {
        if (!signal.aborted) logTTSFailure(err);
      }
    });
  }

  private async onUtterance(text: string) {
    this.transport.event?.({ type: "caller_text", text });
    this.turn?.abort();
    const ctrl = new AbortController();
    this.turn = ctrl;
    const chunker = new SentenceChunker((s) => this.say(s, ctrl.signal));
    try {
      const res = await this.session.handleCallerText(text, { onDelta: (d) => chunker.push(d), signal: ctrl.signal });
      if (ctrl.signal.aborted) return;
      chunker.flush();
      this.transport.event?.({ type: "agent_done", text: res.reply, tools: res.toolLog.map((t) => t.name), booked: res.effects.bookedAppointmentIds });
      await this.ttsChain;
      if (res.effects.handoff) {
        await this.transport.waitForPlayback?.();
        this.onHandoff?.(res.effects.handoff.reason);
      }
    } catch (err) {
      if (!ctrl.signal.aborted) logger.error("voice turn failed", { err });
    } finally {
      if (this.turn === ctrl) this.turn = null;
      this.speaking = false;
    }
  }

  async close() {
    this.turn?.abort();
    this.stt?.close();
  }
}

export class RealtimeController implements CallController {
  private bridge: RealtimeBridge | null = null;
  onHandoff?: (reason: string) => void;

  constructor(
    private readonly session: VoiceCallSession,
    private readonly transport: AudioTransport,
    private readonly format: TTSFormat,
  ) {}

  async start() {
    this.bridge = await openRealtimeAgent({
      session: this.session,
      format: this.format,
      onAudio: (a) => this.transport.sendAudio(a),
      onSpeechStarted: () => {
        this.transport.clearAudio();
        this.transport.event?.({ type: "barge_in" });
      },
      onAgentText: (text) => this.transport.event?.({ type: "agent_done", text }),
      onCallerText: (text) => this.transport.event?.({ type: "caller_text", text }),
      onHandoff: (reason) => {
        // Let the model finish its sentence before transferring.
        setTimeout(() => this.onHandoff?.(reason), 4000);
      },
      onError: (err) => logger.warn("realtime bridge error", { err: err.message }),
    });
  }

  pushAudio(audio: Buffer) {
    this.bridge?.push(audio);
  }

  async close() {
    this.bridge?.close();
  }
}
