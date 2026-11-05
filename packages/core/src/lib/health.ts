/** Health probe shared by web (/api/health) and voice (/health). */
import { sql } from "drizzle-orm";
import { getDb } from "../db/client";

export type Health = {
  status: "ok" | "degraded";
  db: "ok" | "error";
  latencyMs: number;
  /** Seconds the oldest due job has been waiting (worker/cron stalled if large). */
  jobLagSeconds: number | null;
  failedJobs24h: number | null;
  version: string;
  error?: string;
};

export async function checkHealth(): Promise<Health> {
  const started = Date.now();
  const version = process.env.VERCEL_GIT_COMMIT_SHA ?? process.env.RAILWAY_GIT_COMMIT_SHA ?? process.env.FLY_IMAGE_REF ?? "dev";
  try {
    const [row] = (await getDb().execute(sql`
      select
        extract(epoch from (now() - min(run_at) filter (where status = 'pending' and run_at <= now())))::int as lag,
        (count(*) filter (where status = 'failed' and completed_at > now() - interval '24 hours'))::int as failed
      from jobs
    `)) as unknown as { lag: number | null; failed: number }[];
    const lag = row?.lag ?? null;
    const maxLag = Number(process.env.HEALTH_MAX_JOB_LAG_SECONDS ?? 600);
    return {
      status: lag !== null && lag > maxLag ? "degraded" : "ok",
      db: "ok",
      latencyMs: Date.now() - started,
      jobLagSeconds: lag,
      failedJobs24h: row?.failed ?? 0,
      version,
    };
  } catch (e) {
    return { status: "degraded", db: "error", latencyMs: Date.now() - started, jobLagSeconds: null, failedJobs24h: null, version, error: e instanceof Error ? e.message : String(e) };
  }
}
