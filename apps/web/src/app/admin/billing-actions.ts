"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { withSuperAdmin } from "@fekerte/core/db/tenant";
import { invoices, subscriptions } from "@fekerte/core/db/schema";
import { createInvoice, generateMonthlyInvoices, markInvoicePaid, voidInvoice } from "@fekerte/core/billing/invoices";
import { applyPlanChange, planUpdateSchema, updatePlan, updateSubscriptionFees } from "@fekerte/core/billing/plans";
import { getStorage, uploadKey } from "@fekerte/core/providers/storage";
import { audit } from "@fekerte/core/lib/audit";
import { DomainError } from "@fekerte/core/lib/errors";
import { requireSuperAdmin } from "@/lib/auth/current";
import { runAction } from "@/lib/actions";

const adminActor = async () => {
  const admin = await requireSuperAdmin();
  return { type: "user", userId: admin.id, label: admin.email } as const;
};

export async function updatePlanAction(input: z.infer<typeof planUpdateSchema>) {
  return runAction(async () => {
    const actor = await adminActor();
    await withSuperAdmin((tx) => updatePlan(tx, input, actor));
    revalidatePath("/admin/plans");
    return null;
  });
}

const period = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/);

export async function generateInvoicesAction(p: string) {
  return runAction(async () => {
    const actor = await adminActor();
    const created = await withSuperAdmin((tx) => generateMonthlyInvoices(tx, period.parse(p), actor, { statuses: ["active"] }));
    revalidatePath("/admin/invoices");
    return created.length;
  });
}

export async function createInvoiceAction(input: { businessId: string; period: string; notes?: string }) {
  return runAction(async () => {
    const actor = await adminActor();
    const p = z.object({ businessId: z.string().uuid(), period, notes: z.string().max(500).optional() }).parse(input);
    const inv = await withSuperAdmin((tx) => createInvoice(tx, { businessId: p.businessId, period: p.period, notes: p.notes || null, actor }));
    revalidatePath("/admin", "layout");
    return inv.id;
  });
}

const RECEIPT_TYPES = new Set(["image/png", "image/jpeg", "image/webp", "application/pdf"]);
const MAX_RECEIPT = 5 * 1024 * 1024;

/** FormData: invoiceId, method, reference?, receipt? (File). */
export async function markInvoicePaidAction(form: FormData) {
  return runAction(async () => {
    const actor = await adminActor();
    const p = z
      .object({
        invoiceId: z.string().uuid(),
        method: z.enum(["cash", "bank_transfer", "wallet", "card", "other"]),
        reference: z.string().trim().max(120).optional(),
      })
      .parse({ invoiceId: form.get("invoiceId"), method: form.get("method"), reference: form.get("reference") || undefined });
    let receiptUrl: string | null = null;
    const file = form.get("receipt");
    if (file instanceof File && file.size > 0) {
      if (file.size > MAX_RECEIPT) throw new DomainError("VALIDATION", "Receipt must be under 5 MB", { field: "receipt" });
      if (!RECEIPT_TYPES.has(file.type)) throw new DomainError("VALIDATION", "Receipt must be an image or PDF", { field: "receipt" });
      const [inv] = await withSuperAdmin((tx) => tx.select({ businessId: invoices.businessId }).from(invoices).where(eq(invoices.id, p.invoiceId)));
      if (!inv) throw new DomainError("NOT_FOUND", "Invoice not found");
      receiptUrl = await getStorage().put(uploadKey(`receipts/${inv.businessId}`, file.name), Buffer.from(await file.arrayBuffer()), file.type);
    }
    await withSuperAdmin((tx) => markInvoicePaid(tx, { invoiceId: p.invoiceId, method: p.method, reference: p.reference ?? null, receiptUrl, actor }));
    revalidatePath("/admin", "layout");
    return null;
  });
}

export async function voidInvoiceAction(invoiceId: string) {
  return runAction(async () => {
    const actor = await adminActor();
    await withSuperAdmin((tx) => voidInvoice(tx, z.string().uuid().parse(invoiceId), actor));
    revalidatePath("/admin", "layout");
    return null;
  });
}

export async function updateSubscriptionAction(input: { businessId: string; setupFeeCents: number; monthlyFeeCents: number; setupFeePaid: boolean }) {
  return runAction(async () => {
    const actor = await adminActor();
    const id = z.string().uuid().parse(input.businessId);
    await withSuperAdmin((tx) => updateSubscriptionFees(tx, id, { setupFeeCents: input.setupFeeCents, monthlyFeeCents: input.monthlyFeeCents, setupFeePaid: input.setupFeePaid }, actor));
    revalidatePath(`/admin/businesses/${id}`);
    return null;
  });
}

export async function resolvePlanRequestAction(businessId: string, approve: boolean) {
  return runAction(async () => {
    const actor = await adminActor();
    const id = z.string().uuid().parse(businessId);
    await withSuperAdmin(async (tx) => {
      const [sub] = await tx.select().from(subscriptions).where(eq(subscriptions.businessId, id));
      if (!sub?.pendingPlanTier) throw new DomainError("CONFLICT", "No pending request");
      if (approve) await applyPlanChange(tx, id, sub.pendingPlanTier, actor);
      else {
        await tx.update(subscriptions).set({ pendingPlanTier: null }).where(eq(subscriptions.businessId, id));
        await audit(tx, { businessId: id, actor, action: "plan.change_rejected", entityType: "business", entityId: id, changes: { tier: sub.pendingPlanTier } });
      }
    });
    revalidatePath("/admin", "layout");
    return null;
  });
}
