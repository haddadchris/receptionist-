import { and, eq } from "drizzle-orm";
import { withTenant } from "@fekerte/core/db/tenant";
import { calls } from "@fekerte/core/db/schema";
import { fetchRecording } from "@fekerte/core/voice/twilio";
import { getBusinessContext } from "@/lib/auth/current";

export const dynamic = "force-dynamic";

/** Streams a call recording to signed-in staff (Twilio recordings require auth). */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const bc = await getBusinessContext();
  if (!bc) return new Response("Unauthorized", { status: 401 });
  const { id } = await ctx.params;
  if (!/^[0-9a-f-]{36}$/.test(id)) return new Response("Not found", { status: 404 });
  const [call] = await withTenant(bc.business.id, (tx) => tx.select().from(calls).where(and(eq(calls.businessId, bc.business.id), eq(calls.id, id))));
  if (!call?.recordingUrl) return new Response("Not found", { status: 404 });
  const upstream = await fetchRecording(call.recordingUrl);
  if (!upstream.ok || !upstream.body) return new Response("Recording unavailable", { status: 502 });
  return new Response(upstream.body, { headers: { "Content-Type": upstream.headers.get("content-type") ?? "audio/mpeg", "Cache-Control": "private, max-age=3600" } });
}
