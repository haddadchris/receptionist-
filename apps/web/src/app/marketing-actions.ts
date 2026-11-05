"use server";

import { z } from "zod";
import { withSystem } from "@fekerte/core/db/tenant";
import { createLead, leadInputSchema } from "@fekerte/core/sales/leads";
import { getBusinessBySlug } from "@fekerte/core/business/public";
import { signVoiceToken } from "@fekerte/core/voice/tokens";
import { logger } from "@fekerte/core/lib/logger";
import { getT } from "@/i18n/server";
import { clientIp, rateLimit } from "@/lib/rate-limit";
import { errorResult, runAction } from "@/lib/actions";
import { DEMO_SLUG } from "@/lib/demo";


/** "Book a demo" form → lead in the admin pipeline. Rate-limited, honeypot-protected. */
export async function bookDemoAction(input: z.input<typeof leadInputSchema> & { website?: string }) {
  const { t } = await getT();
  const ip = await clientIp();
  if (!rateLimit(`lead:${ip}`, 5, 10 * 60_000).ok) return { ok: false as const, error: t("errors.rateLimited") };
  // Bots fill the hidden "website" field; pretend success.
  if (input.website) return { ok: true as const, data: null };
  try {
    const { lead } = await withSystem((tx) => createLead(tx, { ...input, source: input.source ?? "website" }));
    logger.info("new lead", { leadId: lead.id });
    return { ok: true as const, data: null };
  } catch (e) {
    return errorResult(e);
  }
}

/** Public live demo: a short-lived browser-call token for the demo clinic only (text mode unless audio is explicitly allowed). */
export async function demoVoiceTokenAction(input: { callerPhone?: string | null; mode: "text" | "audio" }) {
  const { t } = await getT();
  const ip = await clientIp();
  if (!rateLimit(`demo-call:${ip}`, 6, 60 * 60_000).ok) return { ok: false as const, error: t("marketing.demoPage.tooMany") };
  return runAction(async () => {
    const business = await getBusinessBySlug(DEMO_SLUG);
    if (!business) throw new Error("Demo business not found");
    const mode = input.mode === "audio" && process.env.DEMO_ALLOW_AUDIO === "true" ? ("audio" as const) : ("text" as const);
    return { token: signVoiceToken({ businessId: business.id, userId: "public-demo", callerPhone: null, mode }, 300) };
  });
}
