"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox, Field, Input, Select } from "@/components/ui/form";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useT } from "@/i18n/client";
import {
  createInvoiceAction,
  generateInvoicesAction,
  markInvoicePaidAction,
  resolvePlanRequestAction,
  updatePlanAction,
  updateSubscriptionAction,
  voidInvoiceAction,
} from "@/app/admin/billing-actions";

type Tier = "basic" | "standard" | "premium";
export type PlanRowInput = {
  tier: Tier;
  name: string;
  setupFeeCents: number;
  monthlyFeeCents: number;
  includedAiMessages: number;
  includedVoiceMinutes: number;
  overageAiMessageCents: number;
  overageVoiceMinuteCents: number;
};

const dollars = (c: number) => String(c / 100);
const cents = (d: string) => Math.round(Number(d || 0) * 100);

export function PlanEditor({ plan }: { plan: PlanRowInput }) {
  const t = useT();
  const router = useRouter();
  const [busy, start] = useTransition();
  const [v, setV] = useState({ ...plan, setup: dollars(plan.setupFeeCents), monthly: dollars(plan.monthlyFeeCents) });
  const num = (k: keyof PlanRowInput) => (e: React.ChangeEvent<HTMLInputElement>) => setV({ ...v, [k]: Number(e.target.value || 0) });
  const save = () =>
    start(async () => {
      const res = await updatePlanAction({
        tier: v.tier,
        name: v.name,
        setupFeeCents: cents(v.setup),
        monthlyFeeCents: cents(v.monthly),
        includedAiMessages: v.includedAiMessages,
        includedVoiceMinutes: v.includedVoiceMinutes,
        overageAiMessageCents: v.overageAiMessageCents,
        overageVoiceMinuteCents: v.overageVoiceMinuteCents,
      });
      if (res.ok) {
        toast.success(t("common.saved"));
        router.refresh();
      } else toast.error(res.error);
    });
  return (
    <div className="grid gap-3" data-testid={`plan-editor-${plan.tier}`}>
      <Field label="Name">
        <Input value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label={t("adminBilling.monthlyFee")}>
          <Input inputMode="decimal" value={v.monthly} onChange={(e) => setV({ ...v, monthly: e.target.value })} aria-label={`${plan.tier} monthly`} />
        </Field>
        <Field label={t("adminBilling.setupFee")}>
          <Input inputMode="decimal" value={v.setup} onChange={(e) => setV({ ...v, setup: e.target.value })} />
        </Field>
        <Field label={t("adminBilling.includedAi")}>
          <Input type="number" min={0} value={v.includedAiMessages} onChange={num("includedAiMessages")} />
        </Field>
        <Field label={t("adminBilling.includedVoice")}>
          <Input type="number" min={0} value={v.includedVoiceMinutes} onChange={num("includedVoiceMinutes")} />
        </Field>
        <Field label={t("adminBilling.overageAi")}>
          <Input type="number" min={0} value={v.overageAiMessageCents} onChange={num("overageAiMessageCents")} />
        </Field>
        <Field label={t("adminBilling.overageVoice")}>
          <Input type="number" min={0} value={v.overageVoiceMinuteCents} onChange={num("overageVoiceMinuteCents")} />
        </Field>
      </div>
      <Button onClick={save} disabled={busy} className="justify-self-start">
        {t("common.save")}
      </Button>
    </div>
  );
}

export function GenerateInvoicesButton({ period }: { period: string }) {
  const t = useT();
  const router = useRouter();
  const [busy, start] = useTransition();
  return (
    <Button
      variant="outline"
      disabled={busy}
      onClick={() =>
        start(async () => {
          const res = await generateInvoicesAction(period);
          if (!res.ok) return void toast.error(res.error);
          toast.success(t("adminBilling.generated", { n: res.data }));
          router.refresh();
        })
      }
    >
      {t("adminBilling.generate", { period })}
    </Button>
  );
}

export function NewInvoiceButton({ businessId, period }: { businessId: string; period: string }) {
  const t = useT();
  const router = useRouter();
  const [busy, start] = useTransition();
  return (
    <Button
      size="sm"
      variant="outline"
      disabled={busy}
      onClick={() =>
        start(async () => {
          const res = await createInvoiceAction({ businessId, period });
          if (!res.ok) return void toast.error(res.error);
          router.push(`/admin/invoices/${res.data}`);
        })
      }
    >
      {t("adminBilling.newInvoice")}
    </Button>
  );
}

export function InvoiceAdminActions({ invoiceId, status }: { invoiceId: string; status: "draft" | "issued" | "paid" | "void" }) {
  const t = useT();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, start] = useTransition();
  if (status === "paid" || status === "void") return null;
  const submit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    form.set("invoiceId", invoiceId);
    start(async () => {
      const res = await markInvoicePaidAction(form);
      if (!res.ok) return void toast.error(res.error);
      toast.success(t("common.saved"));
      setOpen(false);
      router.refresh();
    });
  };
  const voidIt = () => {
    if (!confirm(t("adminBilling.confirmVoid"))) return;
    start(async () => {
      const res = await voidInvoiceAction(invoiceId);
      if (!res.ok) return void toast.error(res.error);
      router.refresh();
    });
  };
  return (
    <div className="flex flex-wrap gap-2">
      <Button size="sm" onClick={() => setOpen(true)}>
        {t("adminBilling.markPaid")}
      </Button>
      <Button size="sm" variant="ghost" onClick={voidIt} disabled={busy}>
        {t("adminBilling.voidInvoice")}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("adminBilling.markPaid")}</DialogTitle>
          </DialogHeader>
          <form onSubmit={submit} className="grid gap-3">
            <Field label={t("adminBilling.method")} htmlFor="pay-method">
              <Select id="pay-method" name="method" defaultValue="bank_transfer">
                {(["bank_transfer", "wallet", "cash", "card", "other"] as const).map((m) => (
                  <option key={m} value={m}>
                    {t(`billing.methods.${m}`)}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label={t("adminBilling.reference")} htmlFor="pay-ref">
              <Input id="pay-ref" name="reference" maxLength={120} />
            </Field>
            <Field label={t("adminBilling.receipt")} htmlFor="pay-receipt">
              <Input id="pay-receipt" name="receipt" type="file" accept="image/png,image/jpeg,image/webp,application/pdf" />
            </Field>
            <Button type="submit" disabled={busy}>
              {t("adminBilling.markPaid")}
            </Button>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export function SubscriptionForm({
  businessId,
  initial,
  pending,
}: {
  businessId: string;
  initial: { setupFeeCents: number; monthlyFeeCents: number; setupFeePaid: boolean };
  pending: { tier: Tier; name: string } | null;
}) {
  const t = useT();
  const router = useRouter();
  const [busy, start] = useTransition();
  const [setup, setSetup] = useState(dollars(initial.setupFeeCents));
  const [monthly, setMonthly] = useState(dollars(initial.monthlyFeeCents));
  const [paid, setPaid] = useState(initial.setupFeePaid);
  const run = (fn: () => Promise<{ ok: boolean; error?: string }>) =>
    start(async () => {
      const res = await fn();
      if (!res.ok) return void toast.error(res.error ?? "Error");
      toast.success(t("common.saved"));
      router.refresh();
    });
  return (
    <div className="grid gap-3">
      {pending ? (
        <div className="flex flex-wrap items-center gap-2 rounded-lg bg-warning/15 p-3 text-sm">
          <span className="flex-1">{t("billing.pendingChange", { plan: pending.name })}</span>
          <Button size="sm" disabled={busy} onClick={() => run(() => resolvePlanRequestAction(businessId, true))}>
            {t("adminBilling.approveChange", { plan: pending.name })}
          </Button>
          <Button size="sm" variant="ghost" disabled={busy} onClick={() => run(() => resolvePlanRequestAction(businessId, false))}>
            {t("adminBilling.rejectChange")}
          </Button>
        </div>
      ) : null}
      <div className="grid grid-cols-2 gap-3">
        <Field label={t("adminBilling.monthlyFee")}>
          <Input inputMode="decimal" value={monthly} onChange={(e) => setMonthly(e.target.value)} />
        </Field>
        <Field label={t("adminBilling.setupFee")}>
          <Input inputMode="decimal" value={setup} onChange={(e) => setSetup(e.target.value)} />
        </Field>
      </div>
      <label className="flex items-center gap-2 text-sm">
        <Checkbox checked={paid} onChange={(e) => setPaid(e.currentTarget.checked)} /> {t("adminBilling.setupPaid")}
      </label>
      <Button
        className="justify-self-start"
        variant="outline"
        disabled={busy}
        onClick={() => run(() => updateSubscriptionAction({ businessId, setupFeeCents: cents(setup), monthlyFeeCents: cents(monthly), setupFeePaid: paid }))}
      >
        {t("common.save")}
      </Button>
    </div>
  );
}
