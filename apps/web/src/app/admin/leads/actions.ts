"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { withSuperAdmin } from "@fekerte/core/db/tenant";
import { LEAD_STAGES, updateLead } from "@fekerte/core/sales/leads";
import { requireSuperAdmin } from "@/lib/auth/current";
import { runAction } from "@/lib/actions";

export async function updateLeadAction(input: { id: string; stage?: (typeof LEAD_STAGES)[number]; note?: string }) {
  return runAction(async () => {
    const admin = await requireSuperAdmin();
    const id = z.string().uuid().parse(input.id);
    await withSuperAdmin((tx) => updateLead(tx, id, { stage: input.stage, note: input.note }, { type: "user", userId: admin.id, label: admin.email }));
    revalidatePath("/admin/leads");
    return null;
  });
}
