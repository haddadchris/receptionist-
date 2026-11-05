import "server-only";
import { headers } from "next/headers";
import { rateLimit as hit, type RateLimitResult } from "@fekerte/core/lib/rate-limit";

/**
 * Rate limiting for actions and API routes. The store is shared Postgres in
 * production (works on serverless / multiple instances) and in-memory in dev
 * (RATE_LIMIT_STORE overrides).
 */
export function rateLimit(key: string, limit: number, windowMs: number): Promise<RateLimitResult> {
  return hit(key, limit, windowMs);
}

export async function clientIp(): Promise<string> {
  const h = await headers();
  return h.get("x-forwarded-for")?.split(",")[0]?.trim() || h.get("x-real-ip") || "local";
}

export function ipFromRequest(req: Request): string {
  return req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || req.headers.get("x-real-ip") || "local";
}
