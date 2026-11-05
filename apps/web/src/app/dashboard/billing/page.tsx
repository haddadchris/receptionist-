import Link from "next/link";
import { CreditCard, Receipt } from "lucide-react";
import { getBillingOverview } from "@fekerte/core/billing/account";
import { requireBusiness } from "@/lib/auth/current";
import { getT } from "@/i18n/server";
import type { TKey } from "@/i18n";
import { PageHeader } from "@/components/ui/stat";
import { Badge, Card, CardContent, CardDescription, CardHeader, CardTitle, EmptyState } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { UsageMeter } from "@/components/billing/usage-meter";
import { PlanPicker, RequestInvoiceButton } from "@/components/billing/plan-picker";
import { fmtDate, fmtPrice } from "@/lib/format";

export const metadata = { title: "Billing" };

const INVOICE_TONE = { draft: "muted", issued: "warning", paid: "success", void: "muted" } as const;

export default async function BillingPage() {
  const ctx = await requireBusiness();
  const { t, locale } = await getT();
  if (ctx.role === "staff") return <EmptyState icon={<CreditCard />} title={t("errors.forbidden")} />;
  const b = ctx.business;
  const o = await getBillingOverview(b);
  const u = o.usage;
  const currentPlan = o.plans.find((p) => p.tier === o.tier);
  const canEdit = !ctx.readOnly && ctx.role === "owner";
  const dateFmt: Intl.DateTimeFormatOptions = { day: "numeric", month: "short", year: "numeric" };
  const statusTone = o.status === "active" ? "success" : o.status === "trial" ? "default" : "warning";

  return (
    <div className="grid gap-5">
      <PageHeader title={t("billing.title")} />

      <div className="grid gap-5 lg:grid-cols-[1fr_360px]">
        <Card>
          <CardHeader className="flex-row flex-wrap items-center justify-between gap-2">
            <div>
              <CardDescription>{t("billing.currentPlan")}</CardDescription>
              <CardTitle className="text-2xl">{currentPlan?.name ?? o.tier}</CardTitle>
            </div>
            <Badge tone={statusTone} data-testid="plan-status">
              {t(`billing.planStatus.${o.status}` as TKey)}
            </Badge>
          </CardHeader>
          <CardContent className="grid gap-4">
            {o.status === "trial" && o.trialDaysLeft !== null ? (
              <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-primary/8 p-3 text-sm">
                <span>{o.trialDaysLeft > 0 ? t("billing.trialBanner", { days: o.trialDaysLeft }) : t("billing.trialEndsToday")}</span>
                {canEdit && !o.openInvoice ? <RequestInvoiceButton /> : null}
              </div>
            ) : null}
            {o.status === "paused" ? <p className="rounded-lg bg-warning/15 p-3 text-sm">{t("billing.pausedBanner")}</p> : null}
            {o.subscription?.pendingPlanTier ? (
              <p className="rounded-lg bg-muted p-3 text-sm">{t("billing.pendingChange", { plan: o.plans.find((p) => p.tier === o.subscription!.pendingPlanTier)?.name ?? "" })}</p>
            ) : null}
            <div className="grid gap-4">
              <h3 className="text-sm font-semibold">{t("billing.usage")}</h3>
              <UsageMeter
                label={t("billing.aiMessages")}
                used={u.aiMessages}
                included={u.includedAiMessages}
                caption={u.includedAiMessages ? t("billing.ofIncluded", { used: u.aiMessages, included: u.includedAiMessages }) : t("billing.notIncluded")}
              />
              <UsageMeter
                label={t("billing.voiceMinutes")}
                used={u.voiceMinutes}
                included={u.includedVoiceMinutes}
                caption={u.includedVoiceMinutes ? t("billing.ofIncluded", { used: u.voiceMinutes, included: u.includedVoiceMinutes }) : t("billing.notIncluded")}
              />
              {u.overageCents > 0 ? <p className="text-sm font-medium text-[oklch(0.5_0.12_70)]">{t("billing.overage", { amount: fmtPrice(u.overageCents) })}</p> : null}
              {currentPlan && (currentPlan.overageAiMessageCents || currentPlan.overageVoiceMinuteCents) ? (
                <p className="text-xs text-muted-foreground">
                  {t("billing.overageNote", {
                    ai: `${currentPlan.overageAiMessageCents}¢`,
                    voice: `${currentPlan.overageVoiceMinuteCents}¢`,
                  })}
                </p>
              ) : null}
            </div>
          </CardContent>
        </Card>

        <div className="grid h-fit gap-5">
          <Card>
            <CardHeader>
              <CardTitle>{t("billing.aiStatus")}</CardTitle>
            </CardHeader>
            <CardContent>
              <ul className="grid gap-2 text-sm">
                {(
                  [
                    ["whatsapp", "billing.features.whatsappAi"],
                    ["webChat", "billing.features.webChat"],
                    ["voice", "billing.features.voiceAi"],
                  ] as const
                ).map(([k, label]) => {
                  const s = o.aiStatus[k];
                  return (
                    <li key={k} className="flex items-center justify-between gap-2">
                      <span>{t(label)}</span>
                      <Badge tone={s === "on" ? "success" : s === "plan" ? "muted" : "warning"} data-testid={`ai-status-${k}`}>
                        {s === "on" ? t("billing.aiOn") : t(`billing.reason.${s}` as TKey)}
                      </Badge>
                    </li>
                  );
                })}
              </ul>
            </CardContent>
          </Card>
          {o.openInvoice ? (
            <Card className="border-warning/50">
              <CardHeader>
                <CardTitle>{t("billing.howToPay")}</CardTitle>
                <CardDescription>{t("billing.openInvoice", { number: o.openInvoice.number, amount: fmtPrice(o.openInvoice.totalCents) })}</CardDescription>
              </CardHeader>
              <CardContent className="grid gap-3 text-sm">
                <p className="whitespace-pre-line">{o.paymentInstructions}</p>
                <p className="font-medium">{t("billing.payReference", { ref: o.openInvoice.number })}</p>
                <Button asChild variant="outline">
                  <Link href={`/dashboard/billing/invoices/${o.openInvoice.id}`}>{t("billing.view")}</Link>
                </Button>
              </CardContent>
            </Card>
          ) : null}
        </div>
      </div>

      <section className="grid gap-3">
        <h2 className="text-lg font-semibold">{t("billing.plans")}</h2>
        <PlanPicker
          plans={o.plans.map((p) => ({
            tier: p.tier,
            name: p.name,
            monthlyFeeCents: p.monthlyFeeCents,
            setupFeeCents: p.setupFeeCents,
            includedAiMessages: p.includedAiMessages,
            includedVoiceMinutes: p.includedVoiceMinutes,
            features: p.features,
          }))}
          current={o.tier}
          pending={o.subscription?.pendingPlanTier ?? null}
          isTrial={o.status === "trial"}
          canEdit={canEdit}
        />
      </section>

      <Card>
        <CardHeader>
          <CardTitle>{t("billing.invoices")}</CardTitle>
        </CardHeader>
        <CardContent>
          {o.invoices.length === 0 ? (
            <EmptyState icon={<Receipt />} title={t("billing.noInvoices")} />
          ) : (
            <ul className="divide-y">
              {o.invoices.map((inv) => (
                <li key={inv.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                  <div className="min-w-0">
                    <p className="font-medium" dir="ltr">
                      {inv.number}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {inv.periodStart ? fmtDate(inv.periodStart.toISOString(), b.timezone, locale, { month: "long", year: "numeric" }) : ""}
                      {" · "}
                      {inv.status === "paid" && inv.paidAt
                        ? t("billing.paidOn", { date: fmtDate(inv.paidAt.toISOString(), b.timezone, locale, dateFmt) })
                        : inv.dueAt
                          ? t("billing.dueOn", { date: fmtDate(inv.dueAt.toISOString(), b.timezone, locale, dateFmt) })
                          : ""}
                    </p>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="font-semibold tabular-nums">{fmtPrice(inv.totalCents)}</span>
                    <Badge tone={INVOICE_TONE[inv.status]}>{t(`billing.invoiceStatus.${inv.status}` as TKey)}</Badge>
                    <Button asChild size="sm" variant="ghost">
                      <Link href={`/dashboard/billing/invoices/${inv.id}`}>{t("billing.view")}</Link>
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
