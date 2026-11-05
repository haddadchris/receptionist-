/**
 * Structured JSON logger (stdout). Sentry-ready: set SENTRY_DSN and wire
 * `captureException` in apps (see apps/web/instrumentation.ts).
 */
type Level = "debug" | "info" | "warn" | "error";

const LEVELS: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };
const minLevel = (): number => LEVELS[(process.env.LOG_LEVEL as Level) ?? "info"] ?? 20;

type ErrorHook = (err: unknown, context?: Record<string, unknown>) => void;
let errorHook: ErrorHook | null = null;

export function setErrorHook(hook: ErrorHook | null) {
  errorHook = hook;
}

function emit(level: Level, msg: string, fields?: Record<string, unknown>) {
  if (LEVELS[level] < minLevel()) return;
  const line = { level, time: new Date().toISOString(), msg, ...fields };
  const out = process.env.LOG_FORMAT === "pretty" || process.env.NODE_ENV === "development" ? prettify(line) : JSON.stringify(line);
  if (level === "error" || level === "warn") console.error(out);
  else console.log(out);
}

function prettify(line: Record<string, unknown>): string {
  const { level, time: _t, msg, ...rest } = line;
  const extra = Object.keys(rest).length ? " " + JSON.stringify(rest) : "";
  return `[${String(level).toUpperCase()}] ${msg}${extra}`;
}

export const logger = {
  debug: (msg: string, fields?: Record<string, unknown>) => emit("debug", msg, fields),
  info: (msg: string, fields?: Record<string, unknown>) => emit("info", msg, fields),
  warn: (msg: string, fields?: Record<string, unknown>) => emit("warn", msg, fields),
  error: (msg: string, fields?: Record<string, unknown> & { err?: unknown }) => {
    const err = fields?.err;
    const serialized = err instanceof Error ? { error: err.message, stack: err.stack } : err ? { error: String(err) } : {};
    emit("error", msg, { ...fields, err: undefined, ...serialized });
    if (err && errorHook) errorHook(err, fields);
  },
};
