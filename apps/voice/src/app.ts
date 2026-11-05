import Fastify from "fastify";
import formbody from "@fastify/formbody";
import websocket from "@fastify/websocket";
import { sql } from "drizzle-orm";
import { getDb } from "@fekerte/core/db/client";
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
    try {
      await getDb().execute(sql`select 1`);
      return {
        status: "ok",
        db: "ok",
        llm: llmProviderKind(),
        twilio: twilioConfigured(),
        realtime: realtimeAvailable(),
        streamingStt: streamingSTTAvailable(),
        tts: ttsProviderKind(),
      };
    } catch (e) {
      return reply.code(503).send({ status: "degraded", db: "error", error: e instanceof Error ? e.message : String(e) });
    }
  });

  registerTwilioRoutes(app);
  registerBrowserRoutes(app);
  return app;
}
