/**
 * Local stand-in for Vercel Cron: pings the jobs endpoint every 20s so
 * reminders and other scheduled messages go out while `pnpm dev` runs.
 */
import "dotenv/config";

const url = `${process.env.APP_URL ?? "http://localhost:3000"}/api/cron/jobs`;
const secret = process.env.CRON_SECRET ?? "dev-cron-secret";
const INTERVAL = Number(process.env.DEV_CRON_INTERVAL_MS ?? 20_000);

async function tick() {
  try {
    const res = await fetch(url, { headers: { authorization: `Bearer ${secret}` } });
    if (res.ok) {
      const body = (await res.json()) as { processed: number; failed: number };
      if (body.processed) console.log(`[cron] processed ${body.processed} job(s), ${body.failed} failed`);
    } else if (res.status !== 404) {
      console.log(`[cron] ${res.status}`);
    }
  } catch {
    // Web server not up yet — try again next tick.
  }
}

setTimeout(tick, 8_000);
setInterval(tick, INTERVAL);
console.log(`[cron] pinging ${url} every ${INTERVAL / 1000}s`);
