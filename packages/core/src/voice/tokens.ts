/** Short-lived signed tokens the web app issues for the browser call simulator. */
import { signValue, verifyValue } from "../booking/tokens";

export type VoiceTokenPayload = { businessId: string; userId: string; callerPhone?: string | null; exp: number; mode?: "text" | "audio" };

export function signVoiceToken(p: Omit<VoiceTokenPayload, "exp">, ttlSeconds = 600): string {
  return signValue(JSON.stringify({ ...p, exp: Math.floor(Date.now() / 1000) + ttlSeconds }), "voice-sim");
}

export function verifyVoiceToken(token: string | null | undefined): VoiceTokenPayload | null {
  if (!token) return null;
  const raw = verifyValue(token, "voice-sim");
  if (!raw) return null;
  try {
    const p = JSON.parse(raw) as VoiceTokenPayload;
    if (!p.businessId || !p.userId || p.exp < Date.now() / 1000) return null;
    return p;
  } catch {
    return null;
  }
}
