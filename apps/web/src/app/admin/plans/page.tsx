import { withSuperAdmin } from "@fekerte/core/db/tenant";
import { listPlans } from "@fekerte/core/billing/plans";
import { TIER_FEATURES } from "@fekerte/core/billing/features";
import { getT } from "@/i18n/server";
import type { TKey } from "@/i18n";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/stat";
import { PlanEditor } from "@/components/admin/billing-admin";

export const metadata = { title: "Plans" };

export default async function AdminPlansPage() {
  const { t } = await getT();
  const rows = await withSuperAdmin((tx) => listPlans(tx));
  return (
    <div>
      <PageHeader title={t("adminBilling.plansTitle")} description={t("adminBilling.plansHint")} />
      <div className="grid gap-4 lg:grid-cols-3">
        {rows.map((p) => (
          <Card key={p.tier}>
            <CardHeader>
              <CardTitle className="capitalize">{p.tier}</CardTitle>
              <CardDescription>{TIER_FEATURES[p.tier].map((f) => t(`billing.features.${f}` as TKey)).join(" · ")}</CardDescription>
            </CardHeader>
            <CardContent>
              <PlanEditor
                plan={{
                  tier: p.tier,
                  name: p.name,
                  setupFeeCents: p.setupFeeCents,
                  monthlyFeeCents: p.monthlyFeeCents,
                  includedAiMessages: p.includedAiMessages,
                  includedVoiceMinutes: p.includedVoiceMinutes,
                  overageAiMessageCents: p.overageAiMessageCents,
                  overageVoiceMinuteCents: p.overageVoiceMinuteCents,
                }}
              />
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
