import { sql } from "drizzle-orm";
import { getDb } from "@fekerte/core/db/client";
import { json } from "@/lib/api";

export const dynamic = "force-dynamic";

export async function GET() {
  const started = Date.now();
  try {
    await getDb().execute(sql`select 1`);
    return json({ status: "ok", db: "ok", latencyMs: Date.now() - started, version: process.env.VERCEL_GIT_COMMIT_SHA ?? "dev" });
  } catch (e) {
    return json({ status: "degraded", db: "error", error: e instanceof Error ? e.message : String(e) }, { status: 503 });
  }
}
