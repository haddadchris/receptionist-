/**
 * Error reporting hook (Sentry-ready, no SDK dependency).
 *
 * With SENTRY_DSN set, every `logger.error(..., { err })` and every Next.js
 * request error (apps/web/src/instrumentation.ts) is sent to Sentry's
 * documented envelope endpoint: POST https://<host>/api/<project>/envelope/
 * with an `X-Sentry-Auth` header. Written from Sentry's public protocol docs and
 * not exercised against a live project here — if you prefer the official SDK,
 * install @sentry/nextjs / @sentry/node and call `setErrorHook` with its
 * `captureException` instead; nothing else changes.
 */
import { randomUUID } from "node:crypto";
import { setErrorHook } from "./logger";

type Dsn = { endpoint: string; publicKey: string };

export function parseDsn(dsn: string | undefined): Dsn | null {
  if (!dsn) return null;
  try {
    const u = new URL(dsn);
    const projectId = u.pathname.replace(/^\/+/, "").split("/").pop();
    if (!u.username || !projectId) return null;
    return { endpoint: `${u.protocol}//${u.host}/api/${projectId}/envelope/`, publicKey: u.username };
  } catch {
    return null;
  }
}

export function buildEnvelope(err: unknown, context: Record<string, unknown> | undefined, opts: { service: string; environment: string; release?: string }) {
  const e = err instanceof Error ? err : new Error(String(err));
  const eventId = randomUUID().replace(/-/g, "");
  const event = {
    event_id: eventId,
    timestamp: Date.now() / 1000,
    platform: "node",
    level: "error",
    environment: opts.environment,
    release: opts.release,
    server_name: opts.service,
    tags: { service: opts.service },
    // Context is structured log fields — never request bodies or customer messages.
    extra: Object.fromEntries(Object.entries(context ?? {}).filter(([k]) => !/^(err|body|text|message|phone)$/i.test(k))),
    exception: { values: [{ type: e.name, value: e.message, stacktrace: e.stack ? { frames: stackFrames(e.stack) } : undefined }] },
  };
  const header = JSON.stringify({ event_id: eventId, sent_at: new Date().toISOString() });
  const item = JSON.stringify(event);
  return { eventId, body: `${header}\n${JSON.stringify({ type: "event", length: Buffer.byteLength(item) })}\n${item}\n` };
}

function stackFrames(stack: string) {
  return stack
    .split("\n")
    .slice(1, 30)
    .map((l) => {
      const m = l.match(/at (?:(.+?) \()?(.+?):(\d+):(\d+)\)?$/);
      return m ? { function: m[1] ?? "?", filename: m[2], lineno: Number(m[3]), colno: Number(m[4]) } : { function: l.trim() };
    })
    .reverse(); // Sentry expects oldest frame first
}

let installed = false;

/** Install once per process. No-op without SENTRY_DSN. */
export function initErrorReporting(service: "web" | "voice" | "worker") {
  if (installed) return;
  installed = true;
  const dsn = parseDsn(process.env.SENTRY_DSN);
  if (!dsn) return;
  const environment = process.env.SENTRY_ENVIRONMENT ?? process.env.NODE_ENV ?? "development";
  const release = process.env.VERCEL_GIT_COMMIT_SHA ?? process.env.RAILWAY_GIT_COMMIT_SHA ?? process.env.FLY_IMAGE_REF;
  setErrorHook((err, context) => {
    const { body } = buildEnvelope(err, context, { service, environment, release });
    void fetch(dsn.endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-sentry-envelope",
        "X-Sentry-Auth": `Sentry sentry_version=7, sentry_key=${dsn.publicKey}, sentry_client=fekerte/1.0`,
      },
      body,
      signal: AbortSignal.timeout(3000),
    }).catch(() => {
      /* never let reporting break the app */
    });
  });
}

/** Report an error that wasn't logged through `logger.error` (e.g. Next.js onRequestError). */
export { setErrorHook };
