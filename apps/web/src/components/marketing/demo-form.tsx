"use client";

import { useEffect, useState, useTransition } from "react";
import { CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/form";
import { useI18n } from "@/i18n/client";
import { bookDemoAction } from "@/app/marketing-actions";

export function DemoForm({ verticals, plans }: { verticals: { id: string; label: string }[]; plans: { tier: "basic" | "standard" | "premium"; name: string }[] }) {
  const { t, locale } = useI18n();
  const [busy, start] = useTransition();
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [plan, setPlan] = useState("");
  // Pricing cards link to ?plan=…#demo; read it after hydration.
  useEffect(() => {
    const fromUrl = new URLSearchParams(window.location.search).get("plan");
    if (fromUrl && ["basic", "standard", "premium"].includes(fromUrl)) setPlan(fromUrl);
  }, []);

  if (done) {
    return (
      <div className="grid justify-items-center gap-2 rounded-2xl border bg-card p-8 text-center" data-testid="demo-success">
        <CheckCircle2 className="size-10 text-success" />
        <p className="text-lg font-semibold">{t("marketing.demoForm.success")}</p>
        <p className="text-sm text-muted-foreground">{t("marketing.demoForm.successText")}</p>
      </div>
    );
  }

  const submit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const get = (k: string) => String(f.get(k) ?? "");
    setError(null);
    start(async () => {
      const res = await bookDemoAction({
        name: get("name"),
        businessName: get("businessName"),
        phone: get("phone"),
        email: get("email"),
        vertical: get("vertical"),
        city: get("city"),
        message: get("message"),
        plan: (plan || undefined) as "basic" | "standard" | "premium" | undefined,
        language: locale,
        website: get("website"),
      });
      if (res.ok) setDone(true);
      else setError(res.error);
    });
  };

  return (
    <form onSubmit={submit} className="grid gap-3 rounded-2xl border bg-card p-5 shadow-sm sm:grid-cols-2 sm:p-6" data-testid="demo-form">
      <Field label={t("marketing.demoForm.name")} htmlFor="lead-name">
        <Input id="lead-name" name="name" required minLength={2} maxLength={80} autoComplete="name" />
      </Field>
      <Field label={t("marketing.demoForm.businessName")} htmlFor="lead-business">
        <Input id="lead-business" name="businessName" maxLength={120} autoComplete="organization" />
      </Field>
      <Field label={t("marketing.demoForm.phone")} htmlFor="lead-phone">
        <Input id="lead-phone" name="phone" required type="tel" inputMode="tel" placeholder="03 123 456" dir="ltr" autoComplete="tel" />
      </Field>
      <Field label={t("marketing.demoForm.email")} htmlFor="lead-email">
        <Input id="lead-email" name="email" type="email" dir="ltr" autoComplete="email" />
      </Field>
      <Field label={t("marketing.demoForm.vertical")} htmlFor="lead-vertical">
        <Select id="lead-vertical" name="vertical" defaultValue="dental">
          {verticals.map((v) => (
            <option key={v.id} value={v.id}>
              {v.label}
            </option>
          ))}
        </Select>
      </Field>
      <Field label={t("marketing.demoForm.city")} htmlFor="lead-city">
        <Input id="lead-city" name="city" maxLength={60} />
      </Field>
      <Field label={t("marketing.demoForm.plan")} htmlFor="lead-plan" className="sm:col-span-2">
        <Select id="lead-plan" value={plan} onChange={(e) => setPlan(e.target.value)}>
          <option value="">{t("marketing.demoForm.noPlan")}</option>
          {plans.map((p) => (
            <option key={p.tier} value={p.tier}>
              {p.name}
            </option>
          ))}
        </Select>
      </Field>
      <Field label={t("marketing.demoForm.message")} htmlFor="lead-message" className="sm:col-span-2">
        <Textarea id="lead-message" name="message" rows={3} maxLength={1000} />
      </Field>
      {/* Honeypot: hidden from people, filled by bots. */}
      <input type="text" name="website" tabIndex={-1} autoComplete="off" className="absolute -start-[9999px] h-0 w-0 opacity-0" aria-hidden />
      {error ? <p className="text-sm text-destructive sm:col-span-2">{error}</p> : null}
      <div className="grid gap-2 sm:col-span-2">
        <Button type="submit" size="lg" disabled={busy}>
          {busy ? t("marketing.demoForm.sending") : t("marketing.demoForm.submit")}
        </Button>
        <p className="text-xs text-muted-foreground">{t("marketing.demoForm.privacy")}</p>
      </div>
    </form>
  );
}
