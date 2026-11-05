"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Field, Select, Input } from "@/components/ui/form";
import { useT } from "@/i18n/client";
import { updateBusinessAdminAction } from "@/app/admin/actions";

type Flag = "whatsappAi" | "webChat" | "voiceAi" | "deposits" | "reviews" | "recalls" | "campaigns";
const FLAGS: Flag[] = ["whatsappAi", "webChat", "voiceAi", "deposits", "reviews", "recalls", "campaigns"];

export function BusinessAdminForm({
  business,
  tierDefaults,
}: {
  business: { id: string; planTier: "basic" | "standard" | "premium"; status: "trial" | "active" | "paused" | "cancelled"; featureFlags: Record<string, boolean | undefined>; trialEndsAt: string | null };
  tierDefaults: Record<"basic" | "standard" | "premium", Flag[]>;
}) {
  const t = useT();
  const router = useRouter();
  const [pending, start] = useTransition();
  const [tier, setTier] = useState(business.planTier);
  const [status, setStatus] = useState(business.status);
  const [flags, setFlags] = useState<Record<string, boolean | undefined>>(business.featureFlags);
  const [trialEnds, setTrialEnds] = useState(business.trialEndsAt?.slice(0, 10) ?? "");

  const save = () =>
    start(async () => {
      const res = await updateBusinessAdminAction({
        businessId: business.id,
        planTier: tier,
        status,
        featureFlags: flags,
        trialEndsAt: trialEnds ? new Date(`${trialEnds}T23:59:00Z`).toISOString() : null,
      });
      if (res.ok) {
        toast.success(t("common.saved"));
        router.refresh();
      } else toast.error(res.error);
    });

  return (
    <div className="grid gap-4">
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label={t("admin.tier")}>
          <Select value={tier} onChange={(e) => setTier(e.target.value as typeof tier)}>
            <option value="basic">Basic</option>
            <option value="standard">Standard</option>
            <option value="premium">Premium</option>
          </Select>
        </Field>
        <Field label={t("admin.status")}>
          <Select value={status} onChange={(e) => setStatus(e.target.value as typeof status)}>
            <option value="trial">trial</option>
            <option value="active">active</option>
            <option value="paused">paused</option>
            <option value="cancelled">cancelled</option>
          </Select>
        </Field>
        <Field label="Trial ends">
          <Input type="date" value={trialEnds} onChange={(e) => setTrialEnds(e.target.value)} />
        </Field>
      </div>
      <div>
        <p className="mb-2 text-sm font-medium">{t("admin.flags")}</p>
        <div className="grid gap-2 sm:grid-cols-2">
          {FLAGS.map((f) => {
            const def = tierDefaults[tier].includes(f);
            const value = flags[f];
            return (
              <div key={f} className="flex items-center justify-between rounded-lg border p-2 text-sm">
                <span>
                  <code>{f}</code> <span className="text-xs text-muted-foreground">(plan: {def ? "on" : "off"})</span>
                </span>
                <Select
                  className="h-8 w-32"
                  value={value === undefined ? "default" : value ? "on" : "off"}
                  onChange={(e) => {
                    const v = e.target.value;
                    setFlags((x) => {
                      const next = { ...x };
                      if (v === "default") delete next[f];
                      else next[f] = v === "on";
                      return next;
                    });
                  }}
                >
                  <option value="default">plan default</option>
                  <option value="on">force on</option>
                  <option value="off">force off</option>
                </Select>
              </div>
            );
          })}
        </div>
      </div>
      <Button onClick={save} disabled={pending} className="justify-self-start">
        {pending ? t("common.saving") : t("common.save")}
      </Button>
    </div>
  );
}
