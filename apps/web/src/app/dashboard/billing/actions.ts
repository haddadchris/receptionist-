"use server";

import { revalidatePath } from "next/cache";
import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { withSystem } from "@fekerte/core/db/tenant";
import { invoices } from "@fekerte/core/db/schema";
import { requestPlanChange } from "@fekerte/core/billing/plans";
import { createInvoice } from "@fekerte/core/billing/invoices";
import { periodKey } from "@fekerte/core/lib/time";
import { requireWritableBusiness } from "@/lib/auth/current";
import { runAction } from "@/lib/actions";

/**
 * Plan/invoice state is protected by RLS (tenants can't write it), so these
 * owner actions verify the session, then run the narrowly-scoped billing
 * operation on the system connection for that one business.
 */
export async function requestPlanChangeAction(tier: "basic" | "standard" | "premium") {
  return runAction(async () => {
    const ctx = await requireWritableBusiness({ ownerOnly: true });
    const p = z.enum(["basic", "standard", "premium"]).parse(tier);
    const result = await withSystem((tx) => requestPlanChange(tx, ctx.business.id, p, ctx.actor));
    revalidatePath("/dashboard", "layout");
    return result;
  });
}

export async function requestInvoiceAction() {
  return runAction(async () => {
    const ctx = await requireWritableBusiness({ ownerOnly: true });
    const id = await withSystem(async (tx) => {
      const [open] = await tx
        .select({ id: invoices.id })
        .from(invoices)
        .where(and(eq(invoices.businessId, ctx.business.id), inArray(invoices.status, ["issued", "draft"])));
      if (open) return open.id;
      const inv = await createInvoice(tx, { businessId: ctx.business.id, period: periodKey(ctx.business.timezone), actor: ctx.actor });
      return inv.id;
    });
    revalidatePath("/dashboard/billing");
    return id;
  });
}
