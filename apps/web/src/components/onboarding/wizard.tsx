"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Check, ExternalLink, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/form";
import { useI18n } from "@/i18n/client";
import { cn } from "@/lib/utils";
import { CopyButton } from "@/components/copy-button";
import { WeeklyHoursEditor, type Rule } from "@/components/settings/weekly-hours-editor";
import { VERTICAL_PRESETS, VERTICALS, type Vertical } from "@fekerte/core/business/presets";
import { saveBusinessStep, saveServicesStep, saveTeamStep } from "@/app/onboarding/actions";
import type { Locale } from "@/i18n";

type ServiceDraft = { name: string; durationMinutes: number; price: string; nameTranslations?: Partial<Record<Locale, string>> };

const ICONS: Record<Vertical, string> = { dental: "🦷", clinic: "🩺", physio: "💪", aesthetic: "✨", salon: "💇‍♀️", barber: "💈", other: "📅" };

export function OnboardingWizard({
  initial,
  userName,
  appUrl,
}: {
  initial: { step: number; businessId: string | null; name: string; vertical: Vertical; phone: string; city: string; slug: string | null };
  userName: string;
  appUrl: string;
}) {
  const { t, locale } = useI18n();
  const router = useRouter();
  const [pending, start] = useTransition();
  const [step, setStep] = useState(initial.step);
  const [businessId, setBusinessId] = useState(initial.businessId);
  const [biz, setBiz] = useState({ name: initial.name, vertical: initial.vertical, phone: initial.phone, city: initial.city, defaultLanguage: locale as Locale });
  const presetServices = (v: Vertical): ServiceDraft[] =>
    VERTICAL_PRESETS[v].services.map((s) => ({
      name: s.name[locale] ?? s.name.en ?? "",
      durationMinutes: s.durationMinutes,
      price: s.priceCents === null ? "" : String(s.priceCents / 100),
      nameTranslations: s.name,
    }));
  const [services, setServices] = useState<ServiceDraft[]>(presetServices(initial.vertical));
  const [hours, setHours] = useState<Rule[]>(VERTICAL_PRESETS[initial.vertical].hours);
  const [staff, setStaff] = useState([{ name: userName, title: "" }]);
  const [slug, setSlug] = useState(initial.slug);

  const steps = [t("onboarding.stepBusiness"), t("onboarding.stepServices"), t("onboarding.stepStaff"), t("onboarding.stepDone")];

  const next = () =>
    start(async () => {
      if (step === 0) {
        const res = await saveBusinessStep(biz);
        if (!res.ok) return void toast.error(res.error);
        setBusinessId(res.data.businessId);
        setServices(presetServices(biz.vertical));
        setHours(VERTICAL_PRESETS[biz.vertical].hours);
        setStep(1);
        router.refresh();
      } else if (step === 1) {
        const valid = services.filter((s) => s.name.trim());
        const res = await saveServicesStep({
          businessId: businessId!,
          locale,
          services: valid.map((s) => ({
            name: s.name.trim(),
            durationMinutes: s.durationMinutes,
            priceCents: s.price === "" ? null : Math.round(Number(s.price) * 100),
            nameTranslations: s.nameTranslations,
          })),
        });
        if (!res.ok) return void toast.error(res.error);
        setStep(2);
      } else if (step === 2) {
        const res = await saveTeamStep({ businessId: businessId!, hours, staff: staff.filter((s) => s.name.trim()), locale });
        if (!res.ok) return void toast.error(res.error);
        setSlug(res.data.slug);
        setStep(3);
      }
    });

  const link = slug ? `${appUrl}/b/${slug}` : "";

  return (
    <div className="mx-auto w-full max-w-2xl">
      <ol className="mb-6 flex items-center gap-2">
        {steps.map((s, i) => (
          <li key={s} className="flex flex-1 items-center gap-2">
            <span
              className={cn(
                "grid size-7 shrink-0 place-items-center rounded-full text-xs font-semibold",
                i < step ? "bg-primary text-primary-foreground" : i === step ? "border-2 border-primary text-primary" : "bg-muted text-muted-foreground",
              )}
            >
              {i < step ? <Check className="size-4" /> : i + 1}
            </span>
            <span className={cn("hidden text-xs sm:inline", i === step ? "font-medium" : "text-muted-foreground")}>{s}</span>
            {i < steps.length - 1 ? <span className="h-px flex-1 bg-border" /> : null}
          </li>
        ))}
      </ol>

      <div className="rounded-2xl border bg-card p-5 shadow-sm sm:p-6">
        {step === 0 ? (
          <div className="grid gap-4">
            <p className="text-sm text-muted-foreground">{t("onboarding.businessIntro")}</p>
            <Field label={t("settings.businessName")}>
              <Input value={biz.name} onChange={(e) => setBiz({ ...biz, name: e.target.value })} autoFocus placeholder="Clinique Dr. ..." />
            </Field>
            <Field label={t("settings.vertical")}>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                {VERTICALS.map((v) => (
                  <button
                    key={v.id}
                    type="button"
                    onClick={() => setBiz({ ...biz, vertical: v.id })}
                    className={cn("rounded-xl border p-3 text-center text-sm transition-colors", biz.vertical === v.id ? "border-primary bg-primary/5 font-medium" : "hover:bg-accent")}
                  >
                    <div className="text-xl">{ICONS[v.id]}</div>
                    {v.label[locale] ?? v.label.en}
                  </button>
                ))}
              </div>
            </Field>
            <div className="grid grid-cols-2 gap-2">
              <Field label={t("settings.phone")}>
                <Input value={biz.phone} onChange={(e) => setBiz({ ...biz, phone: e.target.value })} dir="ltr" inputMode="tel" placeholder="03 123 456" />
              </Field>
              <Field label={t("settings.city")}>
                <Input value={biz.city} onChange={(e) => setBiz({ ...biz, city: e.target.value })} placeholder="Beirut, Jbeil, Jounieh…" />
              </Field>
            </div>
            <Field label={t("settings.defaultLanguage")}>
              <Select value={biz.defaultLanguage} onChange={(e) => setBiz({ ...biz, defaultLanguage: e.target.value as Locale })}>
                <option value="ar">العربية</option>
                <option value="en">English</option>
                <option value="fr">Français</option>
              </Select>
            </Field>
          </div>
        ) : step === 1 ? (
          <div className="grid gap-3">
            <p className="text-sm text-muted-foreground">{t("onboarding.servicesIntro")}</p>
            {services.map((s, i) => (
              <div key={i} className="grid grid-cols-[1fr_80px_80px_auto] items-end gap-2">
                <Field label={i === 0 ? t("appointment.service") : undefined}>
                  <Input value={s.name} onChange={(e) => setServices(services.map((x, j) => (j === i ? { ...x, name: e.target.value, nameTranslations: undefined } : x)))} />
                </Field>
                <Field label={i === 0 ? t("common.min") : undefined}>
                  <Input type="number" min={5} step={5} value={s.durationMinutes} onChange={(e) => setServices(services.map((x, j) => (j === i ? { ...x, durationMinutes: Number(e.target.value) } : x)))} />
                </Field>
                <Field label={i === 0 ? "$" : undefined}>
                  <Input type="number" min={0} value={s.price} onChange={(e) => setServices(services.map((x, j) => (j === i ? { ...x, price: e.target.value } : x)))} dir="ltr" />
                </Field>
                <Button variant="ghost" size="icon" onClick={() => setServices(services.filter((_, j) => j !== i))} aria-label={t("common.remove")} disabled={services.length === 1}>
                  <Trash2 />
                </Button>
              </div>
            ))}
            <Button variant="outline" className="justify-self-start" onClick={() => setServices([...services, { name: "", durationMinutes: 30, price: "" }])}>
              <Plus /> {t("onboarding.addService")}
            </Button>
          </div>
        ) : step === 2 ? (
          <div className="grid gap-4">
            <p className="text-sm text-muted-foreground">{t("onboarding.staffIntro")}</p>
            <div className="grid gap-2">
              {staff.map((s, i) => (
                <div key={i} className="grid grid-cols-[1fr_1fr_auto] items-end gap-2">
                  <Field label={i === 0 ? t("staff.name") : undefined}>
                    <Input value={s.name} onChange={(e) => setStaff(staff.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} />
                  </Field>
                  <Field label={i === 0 ? t("staff.role") : undefined}>
                    <Input value={s.title} onChange={(e) => setStaff(staff.map((x, j) => (j === i ? { ...x, title: e.target.value } : x)))} />
                  </Field>
                  <Button variant="ghost" size="icon" onClick={() => setStaff(staff.filter((_, j) => j !== i))} disabled={staff.length === 1} aria-label={t("common.remove")}>
                    <Trash2 />
                  </Button>
                </div>
              ))}
              <Button variant="outline" className="justify-self-start" onClick={() => setStaff([...staff, { name: "", title: "" }])}>
                <Plus /> {t("onboarding.addStaff")}
              </Button>
            </div>
            <div>
              <p className="mb-2 text-sm font-medium">{t("hours.businessHours")}</p>
              <WeeklyHoursEditor value={hours} onChange={setHours} />
              <p className="mt-2 text-xs text-muted-foreground">{t("onboarding.hoursSame")}</p>
            </div>
          </div>
        ) : (
          <div className="grid gap-4 text-center">
            <div className="text-5xl">🎉</div>
            <h2 className="text-xl font-semibold">{t("onboarding.doneTitle")}</h2>
            <p className="text-sm text-muted-foreground">{t("onboarding.doneText")}</p>
            <code className="rounded-md bg-muted p-3 text-sm break-all" dir="ltr">
              {link}
            </code>
            <div className="flex flex-wrap justify-center gap-2">
              <CopyButton value={link} />
              <Button asChild variant="outline" size="sm">
                <a href={link} target="_blank" rel="noreferrer">
                  <ExternalLink /> {t("common.open")}
                </a>
              </Button>
              <Button asChild variant="outline" size="sm">
                <a href={`https://wa.me/?text=${encodeURIComponent(link)}`} target="_blank" rel="noreferrer">
                  WhatsApp
                </a>
              </Button>
            </div>
            <Button
              size="lg"
              onClick={() => {
                router.push("/dashboard");
                router.refresh();
              }}
            >
              {t("onboarding.goToDashboard")}
            </Button>
          </div>
        )}

        {step < 3 ? (
          <div className="mt-6 flex justify-between gap-2">
            <Button variant="ghost" onClick={() => setStep((s) => Math.max(0, s - 1))} disabled={step === 0 || pending}>
              {t("common.back")}
            </Button>
            <Button size="lg" onClick={next} disabled={pending || (step === 0 && biz.name.trim().length < 2)}>
              {pending ? t("common.saving") : step === 2 ? t("onboarding.finish") : t("common.continue")}
            </Button>
          </div>
        ) : null}
      </div>
    </div>
  );
}
