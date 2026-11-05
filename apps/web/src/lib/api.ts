import "server-only";
import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { isDomainError } from "@fekerte/core/lib/errors";
import { logger } from "@fekerte/core/lib/logger";
import { ipFromRequest, rateLimit } from "./rate-limit";

export function json<T>(data: T, init?: ResponseInit) {
  return NextResponse.json(data, init);
}

export function apiError(e: unknown) {
  if (isDomainError(e)) {
    const status = e.code === "NOT_FOUND" ? 404 : e.code === "FORBIDDEN" ? 403 : e.code === "PLAN_LIMIT" ? 402 : e.code === "VALIDATION" ? 400 : 409;
    return NextResponse.json({ error: e.message, code: e.code, details: e.details ?? null }, { status });
  }
  if (e instanceof ZodError) {
    return NextResponse.json({ error: "Invalid input", code: "VALIDATION", details: e.issues.map((i) => ({ path: i.path.join("."), message: i.message })) }, { status: 400 });
  }
  logger.error("api error", { err: e });
  return NextResponse.json({ error: "Internal error", code: "INTERNAL" }, { status: 500 });
}

/** Returns a 429 response when the caller exceeded the limit, else null. */
export async function limited(req: Request, bucket: string, limit: number, windowMs = 60_000) {
  const r = await rateLimit(`${bucket}:${ipFromRequest(req)}`, limit, windowMs);
  if (r.ok) return null;
  return NextResponse.json(
    { error: "Too many requests", code: "RATE_LIMITED" },
    { status: 429, headers: { "Retry-After": String(Math.ceil(r.retryAfterMs / 1000)) } },
  );
}

export const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};
