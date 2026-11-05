"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Mic, MicOff, Phone, PhoneOff, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/form";
import { Badge } from "@/components/ui/card";
import { useI18n } from "@/i18n/client";
import { cn } from "@/lib/utils";
import { voiceTokenAction } from "@/app/dashboard/voice/actions";

type Turn = { role: "caller" | "agent" | "system"; text: string; tools?: string[]; booked?: boolean };
type Status = "idle" | "connecting" | "listening" | "speaking" | "thinking" | "ended";

const RECOG_LANG = { ar: "ar-LB", en: "en-US", fr: "fr-FR" } as const;
const SPEAK_LANG = { ar: "ar", en: "en", fr: "fr" } as const;

type SpeechRecognitionLike = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((e: { resultIndex: number; results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }> }) => void) | null;
  onspeechstart: (() => void) | null;
  onend: (() => void) | null;
  onerror: ((e: { error: string }) => void) | null;
};

function getRecognition(): (new () => SpeechRecognitionLike) | null {
  const w = window as unknown as { SpeechRecognition?: new () => SpeechRecognitionLike; webkitSpeechRecognition?: new () => SpeechRecognitionLike };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

/** Captures mic audio as 24 kHz PCM16 frames (AudioWorklet). */
const WORKLET = `
class Pcm24k extends AudioWorkletProcessor {
  constructor() { super(); this.ratio = sampleRate / 24000; this.acc = []; this.pos = 0; }
  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (!ch) return true;
    for (let i = 0; i < ch.length; i++) {
      this.pos += 1;
      if (this.pos >= this.ratio) { this.pos -= this.ratio; this.acc.push(Math.max(-1, Math.min(1, ch[i]))); }
    }
    if (this.acc.length >= 480) {
      const out = new Int16Array(this.acc.length);
      for (let i = 0; i < this.acc.length; i++) out[i] = this.acc[i] * 0x7fff;
      this.port.postMessage(out.buffer, [out.buffer]);
      this.acc = [];
    }
    return true;
  }
}
registerProcessor('pcm24k', Pcm24k);`;

export function CallSimulator({ voiceUrl, defaultLanguage, audioAvailable }: { voiceUrl: string; defaultLanguage: "ar" | "en" | "fr"; audioAvailable: boolean }) {
  const { t } = useI18n();
  const [status, setStatus] = useState<Status>("idle");
  const [turns, setTurns] = useState<Turn[]>([]);
  const [partial, setPartial] = useState("");
  const [lang, setLang] = useState<"ar" | "en" | "fr">(defaultLanguage);
  const [mode, setMode] = useState<"text" | "audio">("text");
  const [callerId, setCallerId] = useState("");
  const [typed, setTyped] = useState("");
  const [callId, setCallId] = useState<string | null>(null);
  const [pipeline, setPipeline] = useState<string>("");
  const [speechSupported, setSpeechSupported] = useState(true);

  const ws = useRef<WebSocket | null>(null);
  const recog = useRef<SpeechRecognitionLike | null>(null);
  const speaking = useRef(false);
  const statusRef = useRef<Status>("idle");
  const audioCtx = useRef<AudioContext | null>(null);
  const playHead = useRef(0);
  const sources = useRef<AudioBufferSourceNode[]>([]);
  const micStream = useRef<MediaStream | null>(null);
  const bottom = useRef<HTMLDivElement>(null);

  const setS = (s: Status) => {
    statusRef.current = s;
    setStatus(s);
  };

  useEffect(() => {
    setSpeechSupported(!!getRecognition());
  }, []);
  useEffect(() => {
    bottom.current?.scrollIntoView({ block: "end" });
  }, [turns, partial]);

  // ---- text mode: browser TTS ---------------------------------------------------
  const speak = (text: string, language: "ar" | "en" | "fr") => {
    if (!("speechSynthesis" in window)) return;
    const u = new SpeechSynthesisUtterance(text);
    u.lang = SPEAK_LANG[language];
    const voice = speechSynthesis.getVoices().find((v) => v.lang.toLowerCase().startsWith(SPEAK_LANG[language]));
    if (voice) u.voice = voice;
    u.rate = 1.02;
    u.onstart = () => {
      speaking.current = true;
      setS("speaking");
    };
    u.onend = () => {
      if (!speechSynthesis.speaking) {
        speaking.current = false;
        if (statusRef.current !== "ended") setS("listening");
      }
    };
    speechSynthesis.speak(u);
  };

  const bargeIn = () => {
    if (speaking.current && "speechSynthesis" in window) {
      speechSynthesis.cancel();
      speaking.current = false;
      ws.current?.send(JSON.stringify({ type: "barge_in" }));
    }
  };

  const startRecognition = (language: "ar" | "en" | "fr") => {
    const R = getRecognition();
    if (!R) return;
    const r = new R();
    r.lang = RECOG_LANG[language];
    r.continuous = true;
    r.interimResults = true;
    r.onspeechstart = () => bargeIn();
    r.onresult = (e) => {
      let interim = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const res = e.results[i]!;
        if (res.isFinal) {
          const text = res[0].transcript.trim();
          setPartial("");
          if (text) sendCallerText(text);
        } else interim += res[0].transcript;
      }
      if (interim) {
        bargeIn();
        setPartial(interim);
      }
    };
    r.onend = () => {
      // Chrome stops recognition periodically; keep listening during the call.
      if (statusRef.current !== "ended" && statusRef.current !== "idle") {
        try {
          r.start();
        } catch {
          // already started
        }
      }
    };
    r.onerror = (e) => {
      if (e.error === "not-allowed") setSpeechSupported(false);
    };
    recog.current = r;
    try {
      r.start();
    } catch {
      // ignore
    }
  };

  const sendCallerText = (text: string) => {
    if (!ws.current || ws.current.readyState !== WebSocket.OPEN) return;
    setTurns((x) => [...x, { role: "caller", text }]);
    setS("thinking");
    ws.current.send(JSON.stringify({ type: "caller_text", text }));
  };

  // ---- audio mode: PCM16 24 kHz in/out --------------------------------------------
  const playPcm = (buf: ArrayBuffer) => {
    const ctx = audioCtx.current;
    if (!ctx) return;
    const pcm = new Int16Array(buf);
    const audio = ctx.createBuffer(1, pcm.length, 24000);
    const ch = audio.getChannelData(0);
    for (let i = 0; i < pcm.length; i++) ch[i] = pcm[i]! / 0x8000;
    const src = ctx.createBufferSource();
    src.buffer = audio;
    src.connect(ctx.destination);
    const startAt = Math.max(ctx.currentTime + 0.02, playHead.current);
    src.start(startAt);
    playHead.current = startAt + audio.duration;
    sources.current.push(src);
    src.onended = () => {
      sources.current = sources.current.filter((s) => s !== src);
    };
    setS("speaking");
  };

  const clearPlayback = () => {
    for (const s of sources.current) {
      try {
        s.stop();
      } catch {
        // ignore
      }
    }
    sources.current = [];
    playHead.current = audioCtx.current?.currentTime ?? 0;
  };

  const startMic = async (socket: WebSocket) => {
    const ctx = new AudioContext();
    audioCtx.current = ctx;
    const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
    micStream.current = stream;
    const url = URL.createObjectURL(new Blob([WORKLET], { type: "application/javascript" }));
    await ctx.audioWorklet.addModule(url);
    const node = new AudioWorkletNode(ctx, "pcm24k");
    node.port.onmessage = (e) => socket.readyState === WebSocket.OPEN && socket.send(e.data as ArrayBuffer);
    ctx.createMediaStreamSource(stream).connect(node);
  };

  // ---- call lifecycle ---------------------------------------------------------------
  const start = async () => {
    setTurns([]);
    setCallId(null);
    setS("connecting");
    const res = await voiceTokenAction({ callerPhone: callerId || null, mode });
    if (!res.ok) {
      setTurns([{ role: "system", text: res.error }]);
      return setS("idle");
    }
    const socket = new WebSocket(`${voiceUrl.replace(/^http/, "ws")}/browser/session?token=${encodeURIComponent(res.data.token)}&mode=${mode}`);
    socket.binaryType = "arraybuffer";
    ws.current = socket;
    socket.onmessage = async (ev) => {
      if (typeof ev.data !== "string") return playPcm(ev.data as ArrayBuffer);
      const msg = JSON.parse(ev.data) as { type: string; text?: string; greeting?: string; mode?: string; pipeline?: string; callId?: string; language?: "ar" | "en" | "fr"; tools?: string[]; booked?: string[]; message?: string };
      switch (msg.type) {
        case "ready":
          setCallId(msg.callId ?? null);
          setPipeline(msg.pipeline ?? "");
          if (msg.mode === "audio") {
            await startMic(socket).catch(() => setTurns((x) => [...x, { role: "system", text: "Microphone permission denied" }]));
            setS("listening");
          } else {
            setTurns([{ role: "agent", text: msg.greeting ?? "" }]);
            speak(msg.greeting ?? "", msg.language ?? lang);
            startRecognition(lang);
            setS("speaking");
          }
          break;
        case "agent_delta":
          break; // full reply arrives with agent_done (keeps browser TTS in one natural utterance)
        case "agent_done":
          setTurns((x) => [...x, { role: "agent", text: msg.text ?? "", tools: msg.tools, booked: !!msg.booked?.length }]);
          if (mode === "text") speak(msg.text ?? "", msg.language ?? lang);
          break;
        case "caller_text":
          setTurns((x) => [...x, { role: "caller", text: msg.text ?? "" }]);
          setPartial("");
          break;
        case "caller_partial":
          setPartial(msg.text ?? "");
          break;
        case "clear":
        case "barge_in":
          clearPlayback();
          break;
        case "ended":
          setS("ended");
          break;
        case "error":
          setTurns((x) => [...x, { role: "system", text: msg.message ?? "error" }]);
          break;
      }
    };
    socket.onclose = () => {
      if (statusRef.current !== "idle") setS("ended");
    };
  };

  const hangup = () => {
    try {
      ws.current?.send(JSON.stringify({ type: "hangup" }));
    } catch {
      // ignore
    }
    recog.current?.abort();
    recog.current = null;
    if ("speechSynthesis" in window) speechSynthesis.cancel();
    micStream.current?.getTracks().forEach((tr) => tr.stop());
    clearPlayback();
    audioCtx.current?.close().catch(() => {});
    audioCtx.current = null;
    setTimeout(() => ws.current?.close(), 300);
    if (statusRef.current !== "idle") setS("ended");
  };

  // Hang up if the page is left mid-call. (Not an unmount cleanup: React dev
  // StrictMode/Activity can run cleanups without a real unmount.)
  useEffect(() => {
    const onHide = () => {
      try {
        ws.current?.send(JSON.stringify({ type: "hangup" }));
      } catch {
        // ignore
      }
    };
    window.addEventListener("pagehide", onHide);
    return () => window.removeEventListener("pagehide", onHide);
  }, []);

  const live = status !== "idle" && status !== "ended";
  return (
    <div className="grid gap-4 lg:grid-cols-[320px_1fr]">
      <div className="grid h-fit gap-3 rounded-xl border bg-card p-4">
        <Field label={t("voice.mode")}>
          <Select value={mode} onChange={(e) => setMode(e.target.value as "text" | "audio")} disabled={live}>
            <option value="text">{t("voice.modeText")}</option>
            <option value="audio" disabled={!audioAvailable}>
              {t("voice.modeAudio")}
              {audioAvailable ? "" : " — API keys required"}
            </option>
          </Select>
        </Field>
        <Field label={t("voice.language")}>
          <Select value={lang} onChange={(e) => setLang(e.target.value as "ar" | "en" | "fr")} disabled={live}>
            <option value="ar">العربية (لبنان)</option>
            <option value="en">English</option>
            <option value="fr">Français</option>
          </Select>
        </Field>
        <Field label={t("voice.callerId")} hint={t("voice.callerIdHint")}>
          <Input value={callerId} onChange={(e) => setCallerId(e.target.value)} placeholder="+961 3 123 456" dir="ltr" disabled={live} />
        </Field>
        {!speechSupported && mode === "text" ? <p className="rounded-md bg-warning/15 p-2 text-xs">{t("voice.noSpeech")}</p> : null}
        {live ? (
          <Button variant="destructive" size="lg" onClick={hangup}>
            <PhoneOff /> {t("voice.end")}
          </Button>
        ) : (
          <Button size="lg" onClick={start} data-testid="start-call">
            <Phone /> {t("voice.start")}
          </Button>
        )}
        {pipeline ? <Badge tone="outline" className="justify-self-start">pipeline: {pipeline}</Badge> : null}
        {status === "ended" && callId ? (
          <Link href={`/dashboard/calls/${callId}`} className="text-sm text-primary hover:underline">
            {t("voice.viewLog")} →
          </Link>
        ) : null}
      </div>

      <div className="flex min-h-[480px] flex-col rounded-xl border bg-card">
        <div className="flex items-center gap-2 border-b p-3 text-sm">
          <span
            className={cn(
              "size-2.5 rounded-full",
              status === "listening" ? "animate-pulse bg-success" : status === "speaking" ? "animate-pulse bg-primary" : status === "thinking" ? "animate-pulse bg-warning" : "bg-muted-foreground/40",
            )}
          />
          <span data-testid="call-status">
            {status === "connecting" ? t("voice.connecting") : status === "listening" ? t("voice.listening") : status === "speaking" ? t("voice.speaking") : status === "thinking" ? "…" : status === "ended" ? t("voice.ended") : ""}
          </span>
          {live ? mode === "text" && speechSupported ? <Mic className="ms-auto size-4 text-success" /> : <MicOff className="ms-auto size-4 text-muted-foreground" /> : null}
        </div>
        <div className="flex-1 space-y-2 overflow-y-auto p-3" data-testid="call-transcript">
          {turns.map((turn, i) => (
            <div key={i} className={cn("flex", turn.role === "caller" ? "justify-start" : turn.role === "agent" ? "justify-end" : "justify-center")}>
              <div
                className={cn(
                  "max-w-[85%] rounded-2xl px-3 py-2 text-sm",
                  turn.role === "caller" && "rounded-ss-sm bg-muted",
                  turn.role === "agent" && "rounded-se-sm bg-primary/10",
                  turn.role === "system" && "bg-warning/15 text-xs",
                )}
                dir="auto"
              >
                {turn.text}
                {turn.tools?.length ? <div className="mt-1 text-[10px] text-muted-foreground">🔧 {turn.tools.join(", ")}</div> : null}
                {turn.booked ? (
                  <div className="mt-1">
                    <Badge tone="success">✓ {t("voice.booked")}</Badge>
                  </div>
                ) : null}
              </div>
            </div>
          ))}
          {partial ? <div className="max-w-[85%] rounded-2xl bg-muted/50 px-3 py-2 text-sm text-muted-foreground italic">{partial}…</div> : null}
          <div ref={bottom} />
        </div>
        {live && status !== "connecting" && mode === "text" ? (
          <form
            className="flex gap-2 border-t p-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (typed.trim()) {
                bargeIn();
                sendCallerText(typed.trim());
                setTyped("");
              }
            }}
          >
            <Input value={typed} onChange={(e) => setTyped(e.target.value)} placeholder={t("voice.typeInstead")} dir="auto" data-testid="call-type" />
            <Button type="submit" size="icon" aria-label="send">
              <Send className="rtl:rotate-180" />
            </Button>
          </form>
        ) : null}
      </div>
    </div>
  );
}
