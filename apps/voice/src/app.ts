import Fastify from "fastify";
import formbody from "@fastify/formbody";
import websocket from "@fastify/websocket";
import { checkHealth } from "@fekerte/core/lib/health";
import { logger } from "@fekerte/core/lib/logger";
import { activeCallCount } from "./active";
import { realtimeAvailable } from "@fekerte/core/voice/realtime";
import { streamingSTTAvailable } from "@fekerte/core/voice/stt-stream";
import { ttsProviderKind } from "@fekerte/core/voice/tts";
import { twilioConfigured } from "@fekerte/core/voice/twilio";
import { llmProviderKind } from "@fekerte/core/agent/llm/index";
import { registerTwilioRoutes } from "./twilio";
import { registerBrowserRoutes } from "./browser";

export async function buildApp() {
  const app = Fastify({ logger: process.env.NODE_ENV === "test" ? false : { level: process.env.LOG_LEVEL ?? "info" }, trustProxy: true });
  await app.register(formbody);
  await app.register(websocket, { options: { maxPayload: 1 << 20 } });

  // Browser simulator runs on the web app's origin.
  app.addHook("onRequest", async (req, reply) => {
    reply.header("Access-Control-Allow-Origin", process.env.APP_URL ?? "*");
    if (req.method === "OPTIONS") return reply.code(204).send();
  });

  app.get("/health", async (_req, reply) => {
    const h = await checkHealth();
    return reply.code(h.db === "ok" ? 200 : 503).send({
      ...h,
      activeCalls: activeCallCount(),
      llm: llmProviderKind(),
      twilio: twilioConfigured(),
      realtime: realtimeAvailable(),
      streamingStt: streamingSTTAvailable(),
      tts: ttsProviderKind(),
    });
  });

  // Unexpected errors → structured log → error hook (Sentry when configured).
  app.setErrorHandler((err, req, reply) => {
    logger.error("voice request error", { err, path: req.url.split("?")[0], method: req.method });
    void reply.code(500).send({ error: "Internal error" });
  });

  registerTwilioRoutes(app);
  registerBrowserRoutes(app);
  return app;
}
