/**
 * Signed "manage booking" tokens: customers get a link to view/cancel/reschedule
 * without logging in. token = base64url(appointmentId) + "." + HMAC-SHA256.
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import { config } from "../config";

const b64url = (buf: Buffer) => buf.toString("base64url");

function sign(payload: string, purpose: string): string {
  return b64url(createHmac("sha256", config.appSecret).update(`${purpose}:${payload}`).digest()).slice(0, 32);
}

export function signManageToken(appointmentId: string): string {
  const payload = b64url(Buffer.from(appointmentId));
  return `${payload}.${sign(payload, "manage")}`;
}

export function verifyManageToken(token: string): string | null {
  const [payload, sig] = token.split(".");
  if (!payload || !sig) return null;
  const expected = sign(payload, "manage");
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    return Buffer.from(payload, "base64url").toString("utf8");
  } catch {
    return null;
  }
}

export function manageUrl(slug: string, appointmentId: string): string {
  return `${config.appUrl}/b/${slug}/manage/${signManageToken(appointmentId)}`;
}

export function bookingUrl(slug: string): string {
  return `${config.appUrl}/b/${slug}`;
}

/** Generic signed value helper (used for widget/session tokens). */
export function signValue(value: string, purpose: string): string {
  const payload = b64url(Buffer.from(value));
  return `${payload}.${sign(payload, purpose)}`;
}

export function verifyValue(token: string, purpose: string): string | null {
  const [payload, sig] = token.split(".");
  if (!payload || !sig) return null;
  const expected = sign(payload, purpose);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  return Buffer.from(payload, "base64url").toString("utf8");
}
