/**
 * Fekerte voice server — long-running process for real-time phone audio
 * (Twilio Media Streams) and the browser call simulator. Deploy on Railway/Fly.
 * Also runs a background job worker (reminders etc.) as a second consumer of
 * the Postgres job queue (safe alongside the cron endpoint).
 */
import { config as loadEnv } from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
loadEnv({ path: path.resolve(here, "../../../.env"), quiet: true });
loadEnv({ quiet: true });

const { buildApp } = await import("./app");
const { registerDefaultJobHandlers } = await import("@fekerte/core/jobs/handlers");
const { runDueJobs } = await import("@fekerte/core/jobs/queue");
const { logger } = await import("@fekerte/core/lib/logger");

const app = await buildApp();
const port = Number(process.env.PORT ?? process.env.VOICE_PORT ?? 3001);
await app.listen({ port, host: "0.0.0.0" });
logger.info(`voice server listening on :${port}`);

if (process.env.VOICE_JOB_WORKER !== "false") {
  registerDefaultJobHandlers();
  setInterval(() => {
    runDueJobs({ limit: 25 }).catch((err) => logger.warn("job worker tick failed", { err: String(err) }));
  }, Number(process.env.VOICE_JOB_INTERVAL_MS ?? 15_000));
}

for (const sig of ["SIGINT", "SIGTERM"] as const) {
  process.on(sig, async () => {
    await app.close();
    process.exit(0);
  });
}
