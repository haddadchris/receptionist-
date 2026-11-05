"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/card";
import { useT } from "@/i18n/client";
import type { TKey } from "@/i18n";
import { fmtPrice } from "@/lib/format";
import { cn } from "@/lib/utils";
import { requestInvoiceAction, requestPlanChangeAction } from "@/app/dashboard/billing/actions";

type Tier = "basic" | "standard" | "premium";
export type PlanCard = {
  tier: Tier;
  name: string;
  monthlyFeeCents: number;
  setupFeeCents: number;
  includedAiMessages: number;
  includedVoiceMinutes: number;
  features: string[];
};

export function PlanPicker({ plans, current, pending, isTrial, canEdit }: { plans: PlanCard[]; current: Tier; pending: Tier | null; isTrial: boolean; canEdit: boolean }) {
  const t = useT();
  const router = useRouter();
  const [busy, start] = useTransition();
  const choose = (tier: Tier) =>
    start(async () => {
      const res = await requestPlanChangeAction(tier);
      if (!res.ok) return void toast.error(res.error);
      toast.success(res.data === "requested" ? t("billing.requested") : t("billing.switched"));
      router.refresh();
    });
  return (
    <div className="grid gap-3 md:grid-cols-3">
      {plans.map((p) => {
        const isCurrent = p.tier === current;
        return (
          <div key={p.tier} className={cn("flex flex-col gap-3 rounded-xl border bg-card p-4", isCurrent && "border-primary ring-1 ring-primary")} data-testid={`plan-${p.tier}`}>
            <div className="flex items-center justify-between gap-2">
              <h3 className="font-semibold">{p.name}</h3>
              {isCurrent ? <Badge tone="success">{t("billing.currentBadge")}</Badge> : pending === p.tier ? <Badge tone="warning">…</Badge> : null}
            </div>
            <p>
              <span className="text-2xl font-semibold tabular-nums">{fmtPrice(p.monthlyFeeCents)}</span>
              <span className="text-sm text-muted-foreground">{t("billing.perMonth")}</span>
            </p>
            {p.setupFeeCents ? <p className="-mt-2 text-xs text-muted-foreground">{t("billing.setupFee", { amount: fmtPrice(p.setupFeeCents) })}</p> : null}
            <ul className="grid gap-1.5 text-sm">
              <li className="flex gap-2">
                <Check className="mt-0.5 size-4 shrink-0 text-success" /> {t("billing.onlineBooking")}
              </li>
              {p.features.map((f) => (
                <li key={f} className="flex gap-2">
                  <Check className="mt-0.5 size-4 shrink-0 text-success" /> {t(`billing.features.${f}` as TKey)}
                </li>
              ))}
              {p.includedAiMessages ? <li className="ps-6 text-xs text-muted-foreground">{t("billing.aiIncluded", { n: p.includedAiMessages })}</li> : null}
              {p.includedVoiceMinutes ? <li className="ps-6 text-xs text-muted-foreground">{t("billing.voiceIncluded", { n: p.includedVoiceMinutes })}</li> : null}
            </ul>
            {!isCurrent && canEdit ? (
              <Button className="mt-auto" variant="outline" disabled={busy || pending === p.tier} onClick={() => choose(p.tier)}>
                {isTrial ? t("billing.switchTo") : t("billing.requestPlan")}
              </Button>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

export function RequestInvoiceButton() {
  const t = useT();
  const router = useRouter();
  const [busy, start] = useTransition();
  return (
    <Button
      disabled={busy}
      onClick={() =>
        start(async () => {
          const res = await requestInvoiceAction();
          if (!res.ok) return void toast.error(res.error);
          toast.success(t("billing.invoiceCreated"));
          router.push(`/dashboard/billing/invoices/${res.data}`);
        })
      }
    >
      {t("billing.getInvoice")}
    </Button>
  );
}
