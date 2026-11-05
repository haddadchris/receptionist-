/**
 * Fixed-window rate limiter with two stores:
 *  - "memory": per process (local dev, tests, single long-running instance).
 *  - "postgres": shared across instances via an UNLOGGED table — required on
 *    serverless/multi-instance deployments (each Vercel instance has its own memory).
 * RATE_LIMIT_STORE=memory|postgres (default: postgres in production, memory otherwise).
 */
import { sql } from "drizzle-orm";
import { getDb } from "../db/client";
import { logger } from "./logger";

export type RateLimitResult = { ok: boolean; remaining: number; retryAfterMs: number };

type Bucket = { count: number; resetAt: number };
const g = globalThis as unknown as { __fkRate?: Map<string, Bucket> };
const memory = (g.__fkRate ??= new Map<string, Bucket>());

export function rateLimitStore(): "memory" | "postgres" {
  const v = process.env.RATE_LIMIT_STORE;
  if (v === "memory" || v === "postgres") return v;
  return process.env.NODE_ENV === "production" ? "postgres" : "memory";
}

function hitMemory(key: string, limit: number, windowMs: number): RateLimitResult {
  const now = Date.now();
  let b = memory.get(key);
  if (!b || b.resetAt <= now) {
    b = { count: 0, resetAt: now + windowMs };
    memory.set(key, b);
  }
  b.count++;
  if (memory.size > 50_000) for (const [k, v] of memory) if (v.resetAt <= now) memory.delete(k);
  return { ok: b.count <= limit, remaining: Math.max(0, limit - b.count), retryAfterMs: b.resetAt - now };
}

async function hitPostgres(key: string, limit: number, windowMs: number): Promise<RateLimitResult> {
  const rows = (await getDb().execute(sql`
    insert into rate_limits as r (key, window_start, count) values (${key}, now(), 1)
    on conflict (key) do update set
      count = case when r.window_start + make_interval(secs => ${windowMs / 1000}) <= now() then 1 else r.count + 1 end,
      window_start = case when r.window_start + make_interval(secs => ${windowMs / 1000}) <= now() then now() else r.window_start end
    returning count, greatest(0, extract(epoch from (window_start + make_interval(secs => ${windowMs / 1000}) - now())) * 1000)::int as retry_ms
  `)) as unknown as { count: number; retry_ms: number }[];
  if (Math.random() < 0.01) {
    void getDb()
      .execute(sql`delete from rate_limits where window_start < now() - interval '1 day'`)
      .catch(() => {});
  }
  const count = Number(rows[0]?.count ?? 1);
  return { ok: count <= limit, remaining: Math.max(0, limit - count), retryAfterMs: Number(rows[0]?.retry_ms ?? windowMs) };
}

/** Count one hit for `key`; `ok: false` once more than `limit` hits happened in the window. */
export async function rateLimit(key: string, limit: number, windowMs: number): Promise<RateLimitResult> {
  if (rateLimitStore() === "memory") return hitMemory(key, limit, windowMs);
  try {
    return await hitPostgres(key.slice(0, 200), limit, windowMs);
  } catch (err) {
    // Fail open on the shared store but keep a per-instance limit.
    logger.warn("rate limit store unavailable, using memory", { err: String(err) });
    return hitMemory(key, limit, windowMs);
  }
}
