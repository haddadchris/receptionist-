import { describe, expect, it } from "vitest";
import { createHmac } from "node:crypto";
import { linearToMulaw, mulawToLinear, mulawToPcm16, pcm16ToMulaw, resample, rms } from "../../src/voice/audio";
import { SentenceChunker, toSpeakable } from "../../src/voice/tts";
import { twiml, validateTwilioSignature } from "../../src/voice/twilio";
import { signVoiceToken, verifyVoiceToken } from "../../src/voice/tokens";

describe("G.711 µ-law", () => {
  it("round-trips with bounded quantisation error", () => {
    for (const s of [0, 100, -100, 1000, -1000, 12000, -12000, 32000, -32000]) {
      const back = mulawToLinear(linearToMulaw(s));
      expect(Math.abs(back - s)).toBeLessThanOrEqual(Math.max(8, Math.abs(s) * 0.07));
    }
  });
  it("encodes buffers both ways", () => {
    const pcm = new Int16Array([0, 500, -500, 20000]);
    const back = mulawToPcm16(pcm16ToMulaw(pcm));
    expect(back.length).toBe(4);
    expect(Math.sign(back[3]!)).toBe(1);
  });
  it("resamples 24k → 8k and measures energy", () => {
    const pcm = new Int16Array(2400).fill(1000);
    const out = resample(pcm, 24000, 8000);
    expect(out.length).toBe(800);
    expect(out[400]).toBe(1000);
    expect(rms(new Int16Array(10))).toBe(0);
  });
});

describe("speech text", () => {
  it("makes replies speakable", () => {
    expect(toSpeakable("Done ✅ Price: $60\n1. bukra\n2. ba3d bukra https://x.y/z", "en")).toBe("Done Price: 60 dollars, bukra, ba3d bukra");
    expect(toSpeakable("السعر $80+ مع Dr. Rami", "ar")).toBe("السعر 80 دولار مع الدكتور Rami");
  });
  it("chunks streamed text into sentences early", () => {
    const out: string[] = [];
    const c = new SentenceChunker((s) => out.push(s));
    for (const d of ["أهلا وسهلا، معك مايا من العيادة. ", "كيف فيني ", "ساعدك اليوم؟ ", "تمام"]) c.push(d);
    expect(out[0]).toBe("أهلا وسهلا، معك مايا من العيادة.");
    c.flush();
    expect(out.at(-1)).toBe("تمام");
    expect(out.join(" ")).toContain("كيف فيني ساعدك اليوم؟");
  });
});

describe("Twilio", () => {
  it("validates X-Twilio-Signature", () => {
    const url = "https://voice.example.com/twilio/voice";
    const params = { CallSid: "CA1", From: "+9613000000", To: "+12025550147" };
    const data = url + Object.keys(params).sort().map((k) => k + params[k as keyof typeof params]).join("");
    const sig = createHmac("sha1", "secret").update(data).digest("base64");
    expect(validateTwilioSignature(url, params, sig, "secret")).toBe(true);
    expect(validateTwilioSignature(url, { ...params, From: "+9613000001" }, sig, "secret")).toBe(false);
    expect(validateTwilioSignature(url, params, undefined, "secret")).toBe(false);
  });
  it("builds escaped TwiML", () => {
    const x = twiml.wrap(twiml.stream("wss://v.example.com/twilio/stream", { callId: "a&b" }));
    expect(x).toContain('<Parameter name="callId" value="a&amp;b"/>');
    expect(twiml.gather("https://x/g?a=1&b=2", "ar")).toContain('language="ar-LB"');
  });
});

describe("voice simulator tokens", () => {
  it("signs, verifies and expires", () => {
    const tok = signVoiceToken({ businessId: "b", userId: "u", callerPhone: "+9613000000" });
    expect(verifyVoiceToken(tok)).toMatchObject({ businessId: "b", userId: "u", callerPhone: "+9613000000" });
    expect(verifyVoiceToken(tok.slice(0, -3) + "abc")).toBeNull();
    expect(verifyVoiceToken(signVoiceToken({ businessId: "b", userId: "u" }, -10))).toBeNull();
  });
});
