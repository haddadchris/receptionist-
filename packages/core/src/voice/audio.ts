/**
 * Audio helpers for telephony: G.711 µ-law ⇄ PCM16 and simple linear resampling.
 * Twilio Media Streams carry 8 kHz µ-law; OpenAI Realtime/TTS PCM is 24 kHz;
 * browsers capture at 44.1/48 kHz.
 */

const BIAS = 0x84;
const CLIP = 32635;

export function linearToMulaw(sample: number): number {
  let s = Math.max(-32768, Math.min(32767, sample | 0));
  const sign = s < 0 ? 0x80 : 0;
  if (sign) s = -s;
  if (s > CLIP) s = CLIP;
  s += BIAS;
  let exponent = 7;
  for (let mask = 0x4000; (s & mask) === 0 && exponent > 0; mask >>= 1) exponent--;
  const mantissa = (s >> (exponent + 3)) & 0x0f;
  return ~(sign | (exponent << 4) | mantissa) & 0xff;
}

export function mulawToLinear(u: number): number {
  const v = ~u & 0xff;
  const sign = v & 0x80;
  const exponent = (v >> 4) & 0x07;
  const mantissa = v & 0x0f;
  let sample = ((mantissa << 3) + BIAS) << exponent;
  sample -= BIAS;
  return sign ? -sample : sample;
}

export function pcm16ToMulaw(pcm: Int16Array): Buffer {
  const out = Buffer.alloc(pcm.length);
  for (let i = 0; i < pcm.length; i++) out[i] = linearToMulaw(pcm[i]!);
  return out;
}

export function mulawToPcm16(mulaw: Uint8Array): Int16Array {
  const out = new Int16Array(mulaw.length);
  for (let i = 0; i < mulaw.length; i++) out[i] = mulawToLinear(mulaw[i]!);
  return out;
}

/** Linear-interpolation resampler (good enough for speech at telephone quality). */
export function resample(input: Int16Array, fromRate: number, toRate: number): Int16Array {
  if (fromRate === toRate) return input;
  const ratio = fromRate / toRate;
  const outLen = Math.floor(input.length / ratio);
  const out = new Int16Array(outLen);
  for (let i = 0; i < outLen; i++) {
    const pos = i * ratio;
    const i0 = Math.floor(pos);
    const i1 = Math.min(i0 + 1, input.length - 1);
    const frac = pos - i0;
    out[i] = Math.round(input[i0]! * (1 - frac) + input[i1]! * frac);
  }
  return out;
}

export function bufferToInt16(buf: Buffer | Uint8Array): Int16Array {
  const copy = Buffer.from(buf);
  return new Int16Array(copy.buffer, copy.byteOffset, Math.floor(copy.byteLength / 2));
}

export function int16ToBuffer(pcm: Int16Array): Buffer {
  return Buffer.from(pcm.buffer, pcm.byteOffset, pcm.byteLength);
}

/** Split a buffer into fixed-size frames (Twilio prefers ~20 ms = 160 bytes at 8 kHz µ-law). */
export function* frames(buf: Buffer, size: number): Generator<Buffer> {
  for (let i = 0; i < buf.length; i += size) yield buf.subarray(i, i + size);
}

/** Root-mean-square energy of a PCM16 frame (0..1) — used for simple local VAD. */
export function rms(pcm: Int16Array): number {
  if (!pcm.length) return 0;
  let sum = 0;
  for (let i = 0; i < pcm.length; i++) sum += pcm[i]! * pcm[i]!;
  return Math.sqrt(sum / pcm.length) / 32768;
}
