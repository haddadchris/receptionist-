import Link from "next/link";
import { notFound } from "next/navigation";
import { desc, eq } from "drizzle-orm";
import { ArrowLeft } from "lucide-react";
import { withSuperAdmin } from "@fekerte/core/db/tenant";
import { getBusinessForAdmin } from "@fekerte/core/admin/overview";
import { auditLog } from "@fekerte/core/db/schema";
import { TIER_FEATURES } from "@fekerte/core/billing/features";
import { usageForPeriod } from "@fekerte/core/lib/usage";
import { periodKey } from "@fekerte/core/lib/time";
import { getT } from "@/i18n/server";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Stat } from "@/components/ui/stat";
import { BusinessAdminForm } from "@/components/admin/business-admin-form";
import { startImpersonationAction } from "@/app/admin/actions";
import { fmtDateTime } from "@/lib/format";

export default async function AdminBusinessPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const { t, locale } = await getT();
  const data = await withSuperAdmin(async (tx) => {
    const business = await getBusinessForAdmin(tx, id);
    if (!business) return null;
    const usage = await usageForPeriod(tx, id, periodKey(business.timezone));
    const log = await tx.select().from(auditLog).where(eq(auditLog.businessId, id)).orderBy(desc(auditLog.createdAt)).limit(30);
    return { business, usage, log };
  });
  if (!data) notFound();
  const { business: b, usage, log } = data;
  return (
    <div className="grid gap-5">
      <div className="flex flex-wrap items-center gap-3">
        <Button asChild variant="ghost" size="icon-sm">
          <Link href="/admin">
            <ArrowLeft className="rtl:rotate-180" />
          </Link>
        </Button>
        <h1 className="flex-1 text-xl font-semibold">{b.name}</h1>
        <form action={startImpersonationAction.bind(null, b.id)}>
          <Button type="submit" variant="outline">
            {t("admin.impersonate")}
          </Button>
        </form>
      </div>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label={t("admin.aiMessages")} value={Math.round(usage.ai_message)} />
        <Stat label={t("admin.voiceMinutes")} value={Math.round(usage.voice_minute)} />
        <Stat label="WhatsApp templates" value={Math.round(usage.whatsapp_template)} />
        <Stat label="Slug" value={<span className="text-base" dir="ltr">/b/{b.slug}</span>} />
      </div>
      <div className="grid gap-5 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>{t("admin.changePlan")}</CardTitle>
          </CardHeader>
          <CardContent>
            <BusinessAdminForm
              tierDefaults={TIER_FEATURES as never}
              business={{ id: b.id, planTier: b.planTier, status: b.status, featureFlags: b.featureFlags, trialEndsAt: b.trialEndsAt?.toISOString() ?? null }}
            />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Audit log</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="grid gap-1.5 text-xs">
              {log.map((l) => (
                <li key={l.id} className="flex justify-between gap-2 border-b pb-1.5">
                  <span>
                    <code>{l.action}</code> <span className="text-muted-foreground">by {l.actorType}{l.actorLabel ? ` (${l.actorLabel})` : ""}</span>
                  </span>
                  <span className="shrink-0 text-muted-foreground">{fmtDateTime(l.createdAt.toISOString(), b.timezone, locale)}</span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
