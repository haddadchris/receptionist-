import type { Instrumentation } from "next";

/** Runs once per server instance: install the error-reporting hook (Sentry when SENTRY_DSN is set). */
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { initErrorReporting } = await import("@fekerte/core/lib/error-reporting");
    initErrorReporting("web");
  }
}

/** Every server-side request error (render, route handler, server action, proxy) → structured log → hook. */
export const onRequestError: Instrumentation.onRequestError = async (err, request, context) => {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { logger } = await import("@fekerte/core/lib/logger");
  const digest = typeof err === "object" && err !== null && "digest" in err ? String((err as { digest: unknown }).digest) : undefined;
  logger.error("request error", {
    err,
    digest,
    path: request.path.split("?")[0],
    method: request.method,
    routePath: context.routePath,
    routeType: context.routeType,
  });
};
