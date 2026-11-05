"use server";

import { z } from "zod";
import { signVoiceToken } from "@fekerte/core/voice/tokens";
import { normalizePhone } from "@fekerte/core/lib/phone";
import { runAction } from "@/lib/actions";
import { requireWritableBusiness } from "@/lib/auth/current";
import { DomainError } from "@fekerte/core/lib/errors";

/** Short-lived token for the browser call simulator WebSocket (verified by apps/voice with APP_SECRET). */
export async function voiceTokenAction(input: { callerPhone?: string | null; mode: "text" | "audio" }) {
  return runAction(async () => {
    const ctx = await requireWritableBusiness();
    const p = z.object({ callerPhone: z.string().max(30).nullish(), mode: z.enum(["text", "audio"]) }).parse(input);
    if (ctx.actor.type !== "user") throw new DomainError("FORBIDDEN", "Staff only");
    const callerPhone = p.callerPhone ? normalizePhone(p.callerPhone) : null;
    return { token: signVoiceToken({ businessId: ctx.business.id, userId: ctx.actor.userId, callerPhone, mode: p.mode }) };
  });
}
