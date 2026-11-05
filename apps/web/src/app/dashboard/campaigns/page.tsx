import { Megaphone } from "lucide-react";
import { withTenant } from "@fekerte/core/db/tenant";
import { listCampaigns } from "@fekerte/core/growth/campaigns";
import { allTags } from "@fekerte/core/crm/customers";
import { hasFeature } from "@fekerte/core/billing/features";
import { requireBusiness } from "@/lib/auth/current";
import { getT } from "@/i18n/server";
import type { TKey } from "@/i18n";
import { PageHeader } from "@/components/ui/stat";
import { Badge, Card, CardContent, CardHeader, CardTitle, EmptyState } from "@/components/ui/card";
import { CampaignForm, CampaignRowActions } from "@/components/campaigns/campaign-form";
import { fmtDateTime } from "@/lib/format";

export const metadata = { title: "Campaigns" };

const TONE = { draft: "muted", scheduled: "default", sending: "warning", sent: "success", cancelled: "muted" } as const;
const PRESETS = ["all", "lapsed", "vip", "no_shows", "tag"] as const;

export default async function CampaignsPage({ searchParams }: { searchParams: Promise<{ segment?: string; tag?: string }> }) {
  const sp = await searchParams;
  const ctx = await requireBusiness();
  const { t, locale } = await getT();
  if (!hasFeature(ctx.business, "campaigns")) return <EmptyState icon={<Megaphone />} title={t("ai.planLocked")} />;
  const { rows, tags } = await withTenant(ctx.business.id, async (tx) => ({ rows: await listCampaigns(tx, ctx.business.id), tags: await allTags(tx, ctx.business.id) }));
  const fromSegment = sp.segment === "marketing" ? "all" : sp.tag ? "tag" : sp.segment;
  const initialPreset = PRESETS.includes(fromSegment as never) ? (fromSegment as (typeof PRESETS)[number]) : "lapsed";
  const canEdit = !ctx.readOnly && ctx.role === "owner";
  return (
    <div className="grid gap-5">
      <PageHeader title={t("campaigns.title")} />
      <div className="grid gap-5 lg:grid-cols-[1fr_400px]">
        <Card>
          <CardContent className="p-0 sm:p-0">
            {rows.length === 0 ? (
              <div className="p-4">
                <EmptyState icon={<Megaphone />} title={t("campaigns.empty")} />
              </div>
            ) : (
              <ul className="divide-y">
                {rows.map((c) => (
                  <li key={c.id} className="grid gap-1 p-4" data-testid="campaign-row">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="font-medium">{c.name}</span>
                      <Badge tone={TONE[c.status]}>{t(`campaigns.status.${c.status}` as TKey)}</Badge>
                    </div>
                    <p className="line-clamp-2 text-sm text-muted-foreground">{String(c.variables.message ?? "")}</p>
                    <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
                      <span>
                        {c.status === "sent" || c.status === "sending" ? t("campaigns.sent", { sent: c.sentCount, total: c.recipientCount }) : null}
                        {c.scheduledAt && c.status === "scheduled" ? fmtDateTime(c.scheduledAt.toISOString(), ctx.business.timezone, locale) : null}
                        {c.sentAt ? ` · ${fmtDateTime(c.sentAt.toISOString(), ctx.business.timezone, locale)}` : null}
                      </span>
                      {canEdit ? <CampaignRowActions id={c.id} status={c.status} /> : null}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
        {canEdit ? (
          <Card className="h-fit">
            <CardHeader>
              <CardTitle>{t("campaigns.new")}</CardTitle>
            </CardHeader>
            <CardContent>
              <CampaignForm tags={tags} initialPreset={initialPreset} initialTag={sp.tag ?? ""} />
            </CardContent>
          </Card>
        ) : null}
      </div>
    </div>
  );
}
