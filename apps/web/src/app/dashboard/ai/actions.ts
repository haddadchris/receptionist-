"use server";

import { revalidatePath } from "next/cache";
import { and, eq, ne } from "drizzle-orm";
import { z } from "zod";
import { businesses } from "@fekerte/core/db/schema";
import { withSystem } from "@fekerte/core/db/tenant";
import { audit } from "@fekerte/core/lib/audit";
import { DomainError } from "@fekerte/core/lib/errors";
import { normalizePhone } from "@fekerte/core/lib/phone";
import { tenantAction } from "@/lib/actions";

const schema = z.object({
  personaName: z.string().trim().min(1).max(40),
  tone: z.enum(["warm", "professional", "casual"]),
  extraInstructions: z.string().max(2000).optional(),
  whatsappAutoReply: z.boolean(),
  whatsappNumber: z.string().max(30).nullish(),
  whatsappPhoneNumberId: z.string().trim().max(64).nullish(),
});

export async function saveAiSettingsAction(input: z.infer<typeof schema>) {
  const res = await tenantAction(
    async (tx, ctx) => {
      const p = schema.parse(input);
      const phoneId = p.whatsappPhoneNumberId || null;
      if (phoneId) {
        const taken = await withSystem((sys) =>
          sys.select({ id: businesses.id }).from(businesses).where(and(eq(businesses.whatsappPhoneNumberId, phoneId), ne(businesses.id, ctx.business.id))),
        );
        if (taken.length) throw new DomainError("CONFLICT", "This phone_number_id is already connected to another business");
      }
      await tx
        .update(businesses)
        .set({
          aiSettings: { ...ctx.business.aiSettings, personaName: p.personaName, tone: p.tone, extraInstructions: p.extraInstructions ?? "", whatsappAutoReply: p.whatsappAutoReply },
          whatsappNumber: p.whatsappNumber ? (normalizePhone(p.whatsappNumber) ?? p.whatsappNumber) : null,
          whatsappPhoneNumberId: phoneId,
        })
        .where(eq(businesses.id, ctx.business.id));
      await audit(tx, { businessId: ctx.business.id, actor: ctx.actor, action: "ai_settings.updated", entityType: "business", entityId: ctx.business.id });
      return null;
    },
    { ownerOnly: true },
  );
  if (res.ok) revalidatePath("/dashboard", "layout");
  return res;
}
