/**
 * Recurring system jobs. Every job runner tick calls `scheduleRecurringJobs()`,
 * which idempotently enqueues today's run of each daily task (dedupe key per
 * date), so no external scheduler is needed beyond the per-minute cron ping.
 */
import { DateTime } from "luxon";
import { withSystem } from "../db/tenant";
import { enqueueJob, registerJobHandler } from "./queue";
import { runBillingSweep } from "../billing/sweep";

type Recurring = { type: string; /** Beirut-local hour to run at. */ hour: number; run: () => Promise<unknown> };

const RECURRING: Recurring[] = [{ type: "billing.daily", hour: 3, run: () => runBillingSweep() }];

export function registerRecurring(task: Recurring) {
  if (!RECURRING.some((r) => r.type === task.type)) RECURRING.push(task);
}

let registered = false;
export function registerRecurringHandlers() {
  if (registered) return;
  registered = true;
  for (const r of RECURRING) registerJobHandler(r.type, async () => void (await r.run()));
}

let lastScheduled = "";
export async function scheduleRecurringJobs(now: Date = new Date()) {
  const local = DateTime.fromJSDate(now, { zone: "Asia/Beirut" });
  const key = `${local.toISODate()}:${RECURRING.length}`;
  if (key === lastScheduled) return; // once per process per day
  await withSystem(async (tx) => {
    for (const r of RECURRING) {
      const runAt = local.set({ hour: r.hour, minute: 0, second: 0, millisecond: 0 });
      await enqueueJob(tx, {
        type: r.type,
        runAt: runAt < local ? now : runAt.toJSDate(),
        dedupeKey: `${r.type}:${local.toISODate()}`,
        maxAttempts: 3,
      });
    }
  });
  lastScheduled = key;
}
