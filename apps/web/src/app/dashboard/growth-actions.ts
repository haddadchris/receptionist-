"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { markDepositPaid, waiveDeposit } from "@fekerte/core/growth/deposits";
import { cancelCampaign, campaignInputSchema, createCampaign, previewAudience, scheduleCampaign, segmentSchema } from "@fekerte/core/growth/campaigns";
import { hasFeature } from "@fekerte/core/billing/features";
import { DomainError } from "@fekerte/core/lib/errors";
import { tenantAction } from "@/lib/actions";

const uuid = z.string().uuid();

export async function markDepositPaidAction(input: { id: string; method: "cash" | "bank_transfer" | "wallet" | "card" | "other"; reference?: string }) {
  const res = await tenantAction(async (tx, ctx) => {
    const p = z
      .object({ id: uuid, method: z.enum(["cash", "bank_transfer", "wallet", "card", "other"]), reference: z.string().trim().max(120).optional() })
      .parse(input);
    await markDepositPaid(tx, ctx.business.id, p.id, { method: p.method, reference: p.reference || null, actor: ctx.actor });
    return null;
  });
  if (res.ok) revalidatePath("/dashboard", "layout");
  return res;
}

export async function waiveDepositAction(id: string) {
  const res = await tenantAction(async (tx, ctx) => {
    await waiveDeposit(tx, ctx.business.id, uuid.parse(id), ctx.actor);
    return null;
  });
  if (res.ok) revalidatePath("/dashboard", "layout");
  return res;
}

const requireCampaigns = (b: Parameters<typeof hasFeature>[0]) => {
  if (!hasFeature(b, "campaigns")) throw new DomainError("PLAN_LIMIT", "Campaigns need the Standard plan");
};

export async function previewAudienceAction(segment: z.input<typeof segmentSchema>) {
  return tenantAction(async (tx, ctx) => previewAudience(tx, ctx.business.id, segmentSchema.parse(segment)));
}

export async function createCampaignAction(input: z.input<typeof campaignInputSchema> & { sendAt?: string | null; send?: boolean }) {
  const res = await tenantAction(
    async (tx, ctx) => {
      requireCampaigns(ctx.business);
      const c = await createCampaign(tx, ctx.business.id, input, ctx.actor);
      if (input.send) {
        const at = input.sendAt ? new Date(input.sendAt) : null;
        if (at && Number.isNaN(at.getTime())) throw new DomainError("VALIDATION", "Invalid date");
        await scheduleCampaign(tx, ctx.business.id, c.id, at, ctx.actor);
      }
      return c.id;
    },
    { ownerOnly: true },
  );
  if (res.ok) revalidatePath("/dashboard/campaigns");
  return res;
}

export async function sendCampaignAction(id: string) {
  const res = await tenantAction(
    async (tx, ctx) => {
      requireCampaigns(ctx.business);
      await scheduleCampaign(tx, ctx.business.id, uuid.parse(id), null, ctx.actor);
      return null;
    },
    { ownerOnly: true },
  );
  if (res.ok) revalidatePath("/dashboard/campaigns");
  return res;
}

export async function cancelCampaignAction(id: string) {
  const res = await tenantAction(async (tx, ctx) => {
    await cancelCampaign(tx, ctx.business.id, uuid.parse(id), ctx.actor);
    return null;
  }, { ownerOnly: true });
  if (res.ok) revalidatePath("/dashboard/campaigns");
  return res;
}
