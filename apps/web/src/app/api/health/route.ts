import { checkHealth } from "@fekerte/core/lib/health";
import { json } from "@/lib/api";

export const dynamic = "force-dynamic";

/** Liveness + readiness: DB reachable, background-job lag, recent job failures. 503 when degraded. */
export async function GET() {
  const h = await checkHealth();
  return json(h, { status: h.db === "ok" ? 200 : 503, headers: { "Cache-Control": "no-store" } });
}
