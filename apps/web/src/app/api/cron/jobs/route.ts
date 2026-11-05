import { runDueJobs } from "@fekerte/core/jobs/queue";
import { registerDefaultJobHandlers } from "@fekerte/core/jobs/handlers";
import { config } from "@fekerte/core/config";
import { json } from "@/lib/api";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Processes due background jobs (reminders, follow-ups, recalls…).
 * Vercel Cron calls it every minute with `Authorization: Bearer $CRON_SECRET`.
 * In local dev, scripts/dev-cron.ts pings it every 20 seconds.
 */
async function handle(req: Request) {
  const secret = config.cronSecret;
  const auth = req.headers.get("authorization");
  if (!secret || auth !== `Bearer ${secret}`) return json({ error: "Unauthorized" }, { status: 401 });
  registerDefaultJobHandlers();
  let processed = 0;
  let failed = 0;
  // Drain up to 4 batches per invocation.
  for (let i = 0; i < 4; i++) {
    const r = await runDueJobs({ limit: 25 });
    processed += r.processed;
    failed += r.failed;
    if (r.processed < 25) break;
  }
  return json({ ok: true, processed, failed });
}

export const GET = handle;
export const POST = handle;
