"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { withSuperAdmin } from "@fekerte/core/db/tenant";
import { businesses, type FeatureFlags } from "@fekerte/core/db/schema";
import { audit } from "@fekerte/core/lib/audit";
import { ALL_FEATURES } from "@fekerte/core/billing/features";
import { applyPlanChange } from "@fekerte/core/billing/plans";
import { IMPERSONATE_COOKIE, requireSuperAdmin } from "@/lib/auth/current";
import { runAction } from "@/lib/actions";

export async function startImpersonationAction(businessId: string) {
  const admin = await requireSuperAdmin();
  const id = z.string().uuid().parse(businessId);
  (await cookies()).set(IMPERSONATE_COOKIE, id, { path: "/", httpOnly: true, sameSite: "lax", maxAge: 60 * 60 * 4 });
  await withSuperAdmin((tx) =>
    audit(tx, { businessId: id, actor: { type: "user", userId: admin.id, label: admin.email }, action: "admin.impersonate", entityType: "business", entityId: id }),
  );
  redirect("/dashboard");
}

export async function stopImpersonationAction() {
  (await cookies()).delete(IMPERSONATE_COOKIE);
  redirect("/admin");
}

const tierSchema = z.enum(["basic", "standard", "premium"]);
const statusSchema = z.enum(["trial", "active", "paused", "cancelled"]);

export async function updateBusinessAdminAction(input: {
  businessId: string;
  planTier?: "basic" | "standard" | "premium";
  status?: "trial" | "active" | "paused" | "cancelled";
  featureFlags?: FeatureFlags;
  trialEndsAt?: string | null;
}) {
  return runAction(async () => {
    const admin = await requireSuperAdmin();
    const p = z
      .object({
        businessId: z.string().uuid(),
        planTier: tierSchema.optional(),
        status: statusSchema.optional(),
        featureFlags: z.record(z.string(), z.boolean().optional()).optional(),
        trialEndsAt: z.string().datetime().nullish(),
      })
      .parse(input);
    const flags = p.featureFlags
      ? Object.fromEntries(Object.entries(p.featureFlags).filter(([k, v]) => ALL_FEATURES.includes(k as never) && typeof v === "boolean"))
      : undefined;
    const actor = { type: "user", userId: admin.id, label: admin.email } as const;
    await withSuperAdmin(async (tx) => {
      const [current] = await tx.select({ planTier: businesses.planTier }).from(businesses).where(eq(businesses.id, p.businessId));
      if (p.planTier && current && current.planTier !== p.planTier) await applyPlanChange(tx, p.businessId, p.planTier, actor);
      await tx
        .update(businesses)
        .set({
          ...(p.status ? { status: p.status } : {}),
          ...(flags ? { featureFlags: flags } : {}),
          ...(p.trialEndsAt !== undefined ? { trialEndsAt: p.trialEndsAt ? new Date(p.trialEndsAt) : null } : {}),
        })
        .where(eq(businesses.id, p.businessId));
      await audit(tx, {
        businessId: p.businessId,
        actor,
        action: "admin.business_updated",
        entityType: "business",
        entityId: p.businessId,
        changes: { planTier: p.planTier, status: p.status, featureFlags: flags },
      });
    });
    revalidatePath("/admin", "layout");
    return null;
  });
}
