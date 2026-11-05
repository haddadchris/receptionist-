/**
 * Minimal Postgres-backed job queue.
 * - Jobs are inserted inside the same transaction as the domain change (outbox pattern).
 * - `runDueJobs` claims due jobs with FOR UPDATE SKIP LOCKED, so multiple runners
 *   (cron endpoint, dev loop, voice server) can safely run concurrently.
 * - Failures retry with exponential backoff up to max_attempts.
 */
import { and, eq, inArray, sql } from "drizzle-orm";
import { getDb } from "../db/client";
import type { Tx } from "../db/tenant";
import { jobs, type Job } from "../db/schema";
import { logger } from "../lib/logger";

export type EnqueueInput = {
  type: string;
  businessId?: string | null;
  payload?: Record<string, unknown>;
  runAt?: Date;
  dedupeKey?: string;
  maxAttempts?: number;
};

export async function enqueueJob(tx: Tx, input: EnqueueInput): Promise<void> {
  await tx
    .insert(jobs)
    .values({
      type: input.type,
      businessId: input.businessId ?? null,
      payload: input.payload ?? {},
      runAt: input.runAt ?? new Date(),
      dedupeKey: input.dedupeKey ?? null,
      maxAttempts: input.maxAttempts ?? 5,
    })
    .onConflictDoNothing({ target: jobs.dedupeKey });
}

/** Cancel pending jobs attached to an appointment (e.g. reminders after a reschedule/cancel). */
export async function cancelAppointmentJobs(tx: Tx, appointmentId: string, types?: string[]): Promise<number> {
  const res = await tx
    .update(jobs)
    .set({ status: "cancelled", completedAt: new Date() })
    .where(
      and(
        eq(jobs.status, "pending"),
        sql`${jobs.payload}->>'appointmentId' = ${appointmentId}`,
        types?.length ? inArray(jobs.type, types) : undefined,
      ),
    )
    .returning({ id: jobs.id });
  return res.length;
}

export type JobHandler = (job: Job) => Promise<void | { skipped?: string }>;

const handlers = new Map<string, JobHandler>();

export function registerJobHandler(type: string, handler: JobHandler): void {
  handlers.set(type, handler);
}

export function hasJobHandler(type: string): boolean {
  return handlers.has(type);
}

const STUCK_AFTER_MINUTES = 10;

export async function runDueJobs(opts: { limit?: number; now?: Date } = {}): Promise<{ processed: number; failed: number }> {
  const db = getDb();
  const now = opts.now ?? new Date();
  const limit = opts.limit ?? 25;

  // Recover jobs whose runner died mid-flight.
  await db
    .update(jobs)
    .set({ status: "pending", lockedAt: null })
    .where(and(eq(jobs.status, "running"), sql`${jobs.lockedAt} < now() - make_interval(mins => ${STUCK_AFTER_MINUTES})`));

  const claimed = (await db.execute(sql`
    update jobs set status = 'running', locked_at = now(), attempts = attempts + 1
    where id in (
      select id from jobs
      where status = 'pending' and run_at <= ${now.toISOString()}::timestamptz
      order by run_at
      limit ${limit}
      for update skip locked
    )
    returning id
  `)) as unknown as { id: string }[];

  if (claimed.length === 0) return { processed: 0, failed: 0 };
  const rows = await db.select().from(jobs).where(inArray(jobs.id, claimed.map((c) => c.id)));

  let failed = 0;
  for (const job of rows) {
    const handler = handlers.get(job.type);
    try {
      if (!handler) throw new Error(`No handler registered for job type "${job.type}"`);
      const result = await handler(job);
      await db
        .update(jobs)
        .set({ status: "done", completedAt: new Date(), lastError: result?.skipped ? `skipped: ${result.skipped}` : null })
        .where(eq(jobs.id, job.id));
    } catch (err) {
      failed++;
      const message = err instanceof Error ? err.message : String(err);
      const exhausted = job.attempts >= job.maxAttempts;
      const backoffMinutes = Math.min(60, 2 ** job.attempts);
      logger.warn("job failed", { jobId: job.id, type: job.type, attempt: job.attempts, error: message });
      await db
        .update(jobs)
        .set(
          exhausted
            ? { status: "failed", lastError: message, completedAt: new Date() }
            : { status: "pending", lastError: message, lockedAt: null, runAt: new Date(Date.now() + backoffMinutes * 60_000) },
        )
        .where(eq(jobs.id, job.id));
    }
  }
  return { processed: rows.length, failed };
}
