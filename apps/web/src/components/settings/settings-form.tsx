"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox, Field, Input, Select, Switch, Textarea } from "@/components/ui/form";
import { useI18n } from "@/i18n/client";
import { saveSettingsAction } from "@/app/dashboard/actions";
import type { BookingSettings, Branding, Locale } from "@fekerte/core/db/schema";
import { VERTICALS } from "@fekerte/core/business/presets";

export type SettingsValue = {
  name: string;
  slug: string;
  vertical: string;
  phone: string | null;
  email: string | null;
  address: string | null;
  city: string | null;
  mapsUrl: string | null;
  googleReviewUrl: string | null;
  whatsappNumber: string | null;
  languages: Locale[];
  defaultLanguage: Locale;
  timezone: string;
  showLbp: boolean;
  lbpRate: number;
  branding: Branding;
  bookingSettings: BookingSettings;
};

export function SettingsForm({ initial, appUrl, readOnly }: { initial: SettingsValue; appUrl: string; readOnly?: boolean }) {
  const { t, locale } = useI18n();
  const router = useRouter();
  const [pending, start] = useTransition();
  const [v, setV] = useState(initial);
  const [offsets, setOffsets] = useState(initial.bookingSettings.reminderOffsetsMinutes.map((m) => m / 60).join(", "));
  const set = <K extends keyof SettingsValue>(k: K, val: SettingsValue[K]) => setV((x) => ({ ...x, [k]: val }));
  const setB = <K extends keyof BookingSettings>(k: K, val: BookingSettings[K]) => setV((x) => ({ ...x, bookingSettings: { ...x.bookingSettings, [k]: val } }));

  const save = () =>
    start(async () => {
      const reminderOffsetsMinutes = offsets
        .split(/[,،\s]+/)
        .map((s) => Number(s))
        .filter((n) => Number.isFinite(n) && n > 0)
        .map((h) => Math.round(h * 60));
      const res = await saveSettingsAction({
        ...v,
        phone: v.phone || null,
        email: v.email || "",
        mapsUrl: v.mapsUrl || "",
        googleReviewUrl: v.googleReviewUrl || "",
        branding: { primaryColor: v.branding.primaryColor ?? null, logoUrl: v.branding.logoUrl || "", tagline: v.branding.tagline },
        bookingSettings: { ...v.bookingSettings, reminderOffsetsMinutes, policies: v.bookingSettings.policies ?? {} },
      });
      if (res.ok) {
        toast.success(t("common.saved"));
        router.refresh();
      } else toast.error(res.error);
    });

  const bs = v.bookingSettings;
  return (
    <fieldset disabled={readOnly} className="grid gap-5 lg:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle>{t("settings.general")}</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3">
          <Field label={t("settings.businessName")}>
            <Input value={v.name} onChange={(e) => set("name", e.target.value)} />
          </Field>
          <Field label={t("settings.slug")}>
            <div className="flex items-center rounded-md border" dir="ltr">
              <span className="ps-3 text-sm text-muted-foreground">{appUrl.replace(/^https?:\/\//, "")}/b/</span>
              <input className="h-10 flex-1 bg-transparent pe-3 text-sm outline-none" value={v.slug} onChange={(e) => set("slug", e.target.value.toLowerCase())} />
            </div>
          </Field>
          <Field label={t("settings.vertical")}>
            <Select value={v.vertical} onChange={(e) => set("vertical", e.target.value)}>
              {VERTICALS.map((x) => (
                <option key={x.id} value={x.id}>
                  {x.label[locale] ?? x.label.en}
                </option>
              ))}
            </Select>
          </Field>
          <div className="grid grid-cols-2 gap-2">
            <Field label={t("settings.phone")}>
              <Input value={v.phone ?? ""} onChange={(e) => set("phone", e.target.value)} dir="ltr" inputMode="tel" />
            </Field>
            <Field label={t("settings.whatsappNumber")}>
              <Input value={v.whatsappNumber ?? ""} onChange={(e) => set("whatsappNumber", e.target.value)} dir="ltr" inputMode="tel" />
            </Field>
          </div>
          <Field label={t("settings.email")}>
            <Input value={v.email ?? ""} onChange={(e) => set("email", e.target.value)} dir="ltr" type="email" />
          </Field>
          <div className="grid grid-cols-[1fr_140px] gap-2">
            <Field label={t("settings.address")}>
              <Input value={v.address ?? ""} onChange={(e) => set("address", e.target.value)} />
            </Field>
            <Field label={t("settings.city")}>
              <Input value={v.city ?? ""} onChange={(e) => set("city", e.target.value)} />
            </Field>
          </div>
          <Field label={t("settings.mapsUrl")}>
            <Input value={v.mapsUrl ?? ""} onChange={(e) => set("mapsUrl", e.target.value)} dir="ltr" />
          </Field>
          <Field label={t("settings.reviewUrl")}>
            <Input value={v.googleReviewUrl ?? ""} onChange={(e) => set("googleReviewUrl", e.target.value)} dir="ltr" />
          </Field>
        </CardContent>
      </Card>

      <div className="grid h-fit gap-5">
        <Card>
          <CardHeader>
            <CardTitle>{t("settings.languages")}</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3">
            <div className="flex gap-3">
              {(["ar", "en", "fr"] as Locale[]).map((l) => (
                <label key={l} className="flex items-center gap-2 text-sm">
                  <Checkbox
                    checked={v.languages.includes(l)}
                    onChange={(e) => set("languages", e.target.checked ? [...v.languages, l] : v.languages.filter((x) => x !== l))}
                  />
                  {l === "ar" ? "العربية" : l === "en" ? "English" : "Français"}
                </label>
              ))}
            </div>
            <Field label={t("settings.defaultLanguage")}>
              <Select value={v.defaultLanguage} onChange={(e) => set("defaultLanguage", e.target.value as Locale)}>
                <option value="ar">العربية</option>
                <option value="en">English</option>
                <option value="fr">Français</option>
              </Select>
            </Field>
            <Field label={t("settings.timezone")}>
              <Input value={v.timezone} onChange={(e) => set("timezone", e.target.value)} dir="ltr" />
            </Field>
            <label className="flex items-center gap-2 text-sm">
              <Switch checked={v.showLbp} onCheckedChange={(x) => set("showLbp", x)} /> {t("settings.showLbp")}
            </label>
            {v.showLbp ? (
              <Field label={t("settings.lbpRate")}>
                <Input type="number" value={v.lbpRate} onChange={(e) => set("lbpRate", Number(e.target.value))} dir="ltr" />
              </Field>
            ) : null}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{t("settings.branding")}</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3">
            <div className="grid grid-cols-[120px_1fr] gap-2">
              <Field label={t("settings.primaryColor")}>
                <Input type="color" className="h-10 p-1" value={v.branding.primaryColor ?? "#0e7490"} onChange={(e) => set("branding", { ...v.branding, primaryColor: e.target.value })} />
              </Field>
              <Field label={t("settings.logoUrl")}>
                <Input value={v.branding.logoUrl ?? ""} onChange={(e) => set("branding", { ...v.branding, logoUrl: e.target.value })} dir="ltr" placeholder="https://…" />
              </Field>
            </div>
            <Field label={`${t("settings.tagline")} (${locale})`}>
              <Input
                value={v.branding.tagline?.[locale] ?? ""}
                onChange={(e) => set("branding", { ...v.branding, tagline: { ...(v.branding.tagline ?? {}), [locale]: e.target.value } })}
              />
            </Field>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{t("settings.bookingRules")}</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3">
          <div className="grid grid-cols-2 gap-2">
            <Field label={t("settings.minNotice")}>
              <Input type="number" min={0} step="0.5" value={bs.minNoticeMinutes / 60} onChange={(e) => setB("minNoticeMinutes", Math.round(Number(e.target.value) * 60))} />
            </Field>
            <Field label={t("settings.maxDaysAhead")}>
              <Input type="number" min={1} value={bs.maxDaysAhead} onChange={(e) => setB("maxDaysAhead", Number(e.target.value))} />
            </Field>
            <Field label={t("settings.granularity")}>
              <Select value={bs.slotGranularityMinutes} onChange={(e) => setB("slotGranularityMinutes", Number(e.target.value))}>
                {[5, 10, 15, 20, 30, 60].map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label={t("settings.cancellationNotice")}>
              <Input type="number" min={0} value={bs.cancellationNoticeHours} onChange={(e) => setB("cancellationNoticeHours", Number(e.target.value))} />
            </Field>
          </div>
          <label className="flex items-center gap-2 text-sm">
            <Switch checked={bs.requireApproval} onCheckedChange={(x) => setB("requireApproval", x)} /> {t("settings.requireApproval")}
          </label>
          <Field label={`${t("settings.policies")} (${locale})`}>
            <Textarea rows={3} value={bs.policies?.[locale] ?? ""} onChange={(e) => setB("policies", { ...(bs.policies ?? {}), [locale]: e.target.value })} />
          </Field>
        </CardContent>
      </Card>

      <Card className="h-fit">
        <CardHeader>
          <CardTitle>{t("settings.reminders")}</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3">
          <Field label={t("settings.reminderOffsets")} hint={t("settings.reminderOffsetsHint")}>
            <Input value={offsets} onChange={(e) => setOffsets(e.target.value)} dir="ltr" />
          </Field>
          <label className="flex items-center gap-2 text-sm">
            <Switch checked={bs.askConfirmation} onCheckedChange={(x) => setB("askConfirmation", x)} /> {t("settings.askConfirmation")}
          </label>
        </CardContent>
      </Card>

      {!readOnly ? (
        <div className="sticky bottom-20 z-10 md:bottom-4 lg:col-span-2">
          <Button size="lg" onClick={save} disabled={pending} className="w-full shadow-lg sm:w-auto">
            {pending ? t("common.saving") : t("common.save")}
          </Button>
        </div>
      ) : null}
    </fieldset>
  );
}
