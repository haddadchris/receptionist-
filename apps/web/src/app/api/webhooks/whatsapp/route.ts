import { after } from "next/server";
import { getWhatsAppProvider } from "@fekerte/core/providers/index";
import { verifyWebhookChallenge } from "@fekerte/core/providers/whatsapp/meta";
import { completeReplyJobs, ingestWhatsAppWebhook, processWhatsAppConversation } from "@fekerte/core/channels/whatsapp";
import { registerDefaultJobHandlers } from "@fekerte/core/jobs/handlers";
import { logger } from "@fekerte/core/lib/logger";
import { config } from "@fekerte/core/config";
import { json } from "@/lib/api";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Meta subscription handshake. */
export async function GET(req: Request) {
  const challenge = verifyWebhookChallenge(new URL(req.url).searchParams);
  if (!challenge) return new Response("Forbidden", { status: 403 });
  return new Response(challenge, { status: 200, headers: { "Content-Type": "text/plain" } });
}

/**
 * Inbound messages + delivery statuses. We verify X-Hub-Signature-256 on the
 * raw body, store events idempotently, answer 200 immediately, then generate
 * the AI reply after the response (cron retries anything that fails).
 */
export async function POST(req: Request) {
  const raw = await req.text();
  const provider = getWhatsAppProvider();
  if (provider.name === "mock") {
    // The mock provider has no signing secret: never accept unsigned traffic in production.
    if (config.isProduction) return json({ error: "webhook disabled (mock provider)" }, { status: 403 });
  } else if (!provider.verifySignature(raw, req.headers.get("x-hub-signature-256"))) {
    logger.warn("whatsapp webhook: bad signature");
    return json({ error: "invalid signature" }, { status: 401 });
  }
  let payload: unknown;
  try {
    payload = JSON.parse(raw);
  } catch {
    return json({ error: "invalid json" }, { status: 400 });
  }
  registerDefaultJobHandlers();
  const result = await ingestWhatsAppWebhook(payload);
  after(async () => {
    for (const c of result.conversations) {
      try {
        const outcome = await processWhatsAppConversation(c.businessId, c.conversationId);
        if (outcome !== "locked") await completeReplyJobs(c.conversationId);
      } catch (err) {
        logger.error("whatsapp reply failed (cron will retry)", { err, conversationId: c.conversationId });
      }
    }
  });
  return json({ ok: true, processed: result.processed });
}
