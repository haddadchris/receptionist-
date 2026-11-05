import "server-only";
import { headers } from "next/headers";

/**
 * Fixed-window in-memory rate limiter. Good enough for a single Node instance
 * and local dev; on multi-instance/serverless deployments swap the store for
 * Redis/Upstash (same interface) — see README "Hardening".
 */
type Bucket = { count: number; resetAt: number };
const store = (globalThis as unknown as { __fkRate?: Map<string, Bucket> }).__fkRate ?? new Map<string, Bucket>();
(globalThis as unknown as { __fkRate?: Map<string, Bucket> }).__fkRate = store;

export function rateLimit(key: string, limit: number, windowMs: number): { ok: boolean; remaining: number; retryAfterMs: number } {
  const now = Date.now();
  let b = store.get(key);
  if (!b || b.resetAt <= now) {
    b = { count: 0, resetAt: now + windowMs };
    store.set(key, b);
  }
  b.count++;
  if (store.size > 50_000) {
    for (const [k, v] of store) if (v.resetAt <= now) store.delete(k);
  }
  return { ok: b.count <= limit, remaining: Math.max(0, limit - b.count), retryAfterMs: b.resetAt - now };
}

export async function clientIp(): Promise<string> {
  const h = await headers();
  return h.get("x-forwarded-for")?.split(",")[0]?.trim() || h.get("x-real-ip") || "local";
}

export function ipFromRequest(req: Request): string {
  return req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || req.headers.get("x-real-ip") || "local";
}
