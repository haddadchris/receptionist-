"use client";

import { useState } from "react";
import { toast } from "sonner";
import { ArrowLeft, CalendarPlus, Check, ChevronRight, Clock, User } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox, Field, Input, Textarea } from "@/components/ui/form";
import { useI18n } from "@/i18n/client";
import { cn, initials } from "@/lib/utils";
import { fmtDate, fmtPrice, fmtTime } from "@/lib/format";
import { SlotPicker, type PublicSlot } from "./slot-picker";
import type { LocalizedText } from "@fekerte/core/db/schema";

export type BookingService = {
  id: string;
  name: LocalizedText;
  description: LocalizedText;
  durationMinutes: number;
  priceCents: number | null;
  priceFrom: boolean;
  staffIds: string[];
};
export type BookingStaff = { id: string; name: string; title: LocalizedText; color: string };

type Step = "service" | "staff" | "time" | "details" | "done";

export function BookingFlow({
  slug,
  businessName,
  tz,
  services,
  staff,
  allowAnyStaff,
  showLbp,
  lbpRate,
}: {
  slug: string;
  businessName: string;
  tz: string;
  services: BookingService[];
  staff: BookingStaff[];
  allowAnyStaff: boolean;
  showLbp: boolean;
  lbpRate: number;
}) {
  const { t, locale } = useI18n();
  const [step, setStep] = useState<Step>("service");
  const [service, setService] = useState<BookingService | null>(null);
  const [staffId, setStaffId] = useState<string | null>(null);
  const [slot, setSlot] = useState<PublicSlot | null>(null);
  const [form, setForm] = useState({ name: "", phone: "", notes: "", marketing: false, website: "" });
  const [submitting, setSubmitting] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const [result, setResult] = useState<{ status: string; manageUrl: string; staffId: string; deposit: { cents: number; dueAt: string } | null } | null>(null);

  const pick = (x: LocalizedText) => x[locale] || x.en || x.ar || x.fr || "";
  const staffFor = (s: BookingService) => staff.filter((m) => s.staffIds.includes(m.id));
  const staffName = (id: string | null) => staff.find((m) => m.id === id)?.name;

  const chooseService = (s: BookingService) => {
    setService(s);
    setSlot(null);
    const options = staffFor(s);
    if (options.length === 1) {
      setStaffId(options[0]!.id);
      setStep("time");
    } else {
      setStaffId(null);
      setStep("staff");
    }
  };

  const back = () => {
    if (step === "staff") setStep("service");
    else if (step === "time") setStep(service && staffFor(service).length > 1 ? "staff" : "service");
    else if (step === "details") setStep("time");
  };

  const submit = async () => {
    if (!service || !slot) return;
    setSubmitting(true);
    try {
      const res = await fetch(`/api/public/${slug}/book`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          serviceId: service.id,
          staffId,
          startsAt: slot.start,
          name: form.name,
          phone: form.phone,
          notes: form.notes || undefined,
          language: locale,
          consentMarketing: form.marketing,
          website: form.website,
        }),
      });
      const data = await res.json();
      if (res.ok) {
        setResult({ status: data.status, manageUrl: data.manageUrl, staffId: data.staffId, deposit: data.deposit ?? null });
        setStep("done");
      } else if (data.code === "SLOT_UNAVAILABLE") {
        toast.error(t("booking.slotTaken"));
        setSlot(null);
        setRefreshKey((k) => k + 1);
        setStep("time");
      } else if (data.code === "VALIDATION" && data.details?.field === "phone") {
        toast.error(t("errors.invalidPhone"));
      } else if (data.code === "RATE_LIMITED") {
        toast.error(t("errors.rateLimited"));
      } else {
        toast.error(data.error ?? t("common.error"));
      }
    } catch {
      toast.error(t("common.error"));
    } finally {
      setSubmitting(false);
    }
  };

  const calendarLink = () => {
    if (!service || !slot) return "#";
    const f = (iso: string) => iso.replace(/[-:]/g, "").replace(/\.\d{3}/, "");
    const p = new URLSearchParams({ action: "TEMPLATE", text: `${pick(service.name)} — ${businessName}`, dates: `${f(slot.start)}/${f(slot.end)}`, details: result?.manageUrl ?? "" });
    return `https://calendar.google.com/calendar/render?${p}`;
  };

  if (services.length === 0) return <p className="rounded-xl bg-muted p-6 text-center text-sm text-muted-foreground">{t("booking.closed")}</p>;

  if (step === "done" && service && slot && result) {
    const pending = result.status === "pending";
    return (
      <div className="grid gap-4 text-center" data-testid="booking-success">
        <div className="mx-auto grid size-16 place-items-center rounded-full bg-success/15 text-success">
          <Check className="size-8" />
        </div>
        <h2 className="text-xl font-semibold">{pending ? t("booking.pendingTitle") : t("booking.successTitle")}</h2>
        {result.deposit ? (
          <p className="rounded-xl border border-warning/40 bg-warning/10 p-3 text-sm" data-testid="deposit-notice">
            {t("deposit.bookingHeld", {
              amount: fmtPrice(result.deposit.cents),
              date: `${fmtDate(result.deposit.dueAt, tz, locale, { weekday: "short", day: "numeric", month: "short" })} ${fmtTime(result.deposit.dueAt, tz, locale)}`,
            })}
          </p>
        ) : (
          <p className="text-sm text-muted-foreground">{pending ? t("booking.pendingText") : t("booking.successText")}</p>
        )}
        <div className="rounded-xl border bg-card p-4 text-start text-sm">
          <p className="font-medium">{pick(service.name)}</p>
          <p className="text-muted-foreground">
            {fmtDate(slot.start, tz, locale, { weekday: "long", day: "numeric", month: "long" })} · <span className="ltr-nums">{fmtTime(slot.start, tz, locale)}</span>
          </p>
          {staffName(result.staffId) ? (
            <p className="text-muted-foreground">
              {t("booking.with")} {staffName(result.staffId)}
            </p>
          ) : null}
        </div>
        <div className="grid gap-2 sm:grid-cols-2">
          <Button asChild variant="outline">
            <a href={calendarLink()} target="_blank" rel="noreferrer">
              <CalendarPlus /> {t("booking.addToCalendar")}
            </a>
          </Button>
          <Button asChild variant="outline">
            <a href={result.manageUrl}>{t("booking.manage")}</a>
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-4">
      <div className="flex items-center gap-2">
        {step !== "service" ? (
          <Button variant="ghost" size="icon-sm" onClick={back} aria-label={t("common.back")}>
            <ArrowLeft className="rtl:rotate-180" />
          </Button>
        ) : null}
        <h2 className="text-lg font-semibold">
          {step === "service" ? t("booking.chooseService") : step === "staff" ? t("booking.chooseStaff") : step === "time" ? t("booking.chooseTime") : t("booking.yourDetails")}
        </h2>
      </div>

      {service && step !== "service" ? (
        <div className="flex flex-wrap items-center gap-2 rounded-xl bg-muted/70 p-3 text-xs">
          <span className="font-medium">{pick(service.name)}</span>
          <span className="text-muted-foreground">· {service.durationMinutes} {t("common.min")}</span>
          {staffId ? <span className="text-muted-foreground">· {staffName(staffId)}</span> : step !== "staff" ? <span className="text-muted-foreground">· {t("booking.anyStaff")}</span> : null}
          {slot && step === "details" ? (
            <span className="text-muted-foreground">
              · {fmtDate(slot.start, tz, locale)} <span className="ltr-nums">{fmtTime(slot.start, tz, locale)}</span>
            </span>
          ) : null}
        </div>
      ) : null}

      {step === "service" ? (
        <ul className="grid gap-2">
          {services.map((s) => (
            <li key={s.id}>
              <button
                type="button"
                onClick={() => chooseService(s)}
                className="flex w-full items-center gap-3 rounded-xl border bg-card p-4 text-start transition-colors hover:border-primary"
              >
                <div className="min-w-0 flex-1">
                  <p className="font-medium">{pick(s.name)}</p>
                  {pick(s.description) ? <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">{pick(s.description)}</p> : null}
                  <p className="mt-1 flex items-center gap-1 text-xs text-muted-foreground">
                    <Clock className="size-3" /> {s.durationMinutes} {t("common.min")}
                  </p>
                </div>
                <div className="text-end text-sm font-semibold">
                  {s.priceCents !== null ? (
                    s.priceFrom ? (
                      <span className="text-xs font-medium">{t("booking.fromPrice", { price: fmtPrice(s.priceCents, { showLbp, lbpRate }) })}</span>
                    ) : (
                      fmtPrice(s.priceCents, { showLbp, lbpRate })
                    )
                  ) : (
                    <span className="text-xs font-normal text-muted-foreground">{t("booking.priceOnRequest")}</span>
                  )}
                </div>
                <ChevronRight className="size-4 text-muted-foreground rtl:rotate-180" />
              </button>
            </li>
          ))}
        </ul>
      ) : step === "staff" && service ? (
        <ul className="grid gap-2">
          {allowAnyStaff ? (
            <li>
              <button
                type="button"
                onClick={() => {
                  setStaffId(null);
                  setStep("time");
                }}
                className="flex w-full items-center gap-3 rounded-xl border bg-card p-4 text-start hover:border-primary"
              >
                <span className="grid size-10 place-items-center rounded-full bg-primary/10 text-primary">
                  <User className="size-5" />
                </span>
                <div>
                  <p className="font-medium">{t("booking.anyStaff")}</p>
                  <p className="text-xs text-muted-foreground">{t("booking.anyStaffHint")}</p>
                </div>
              </button>
            </li>
          ) : null}
          {staffFor(service).map((m) => (
            <li key={m.id}>
              <button
                type="button"
                onClick={() => {
                  setStaffId(m.id);
                  setStep("time");
                }}
                className="flex w-full items-center gap-3 rounded-xl border bg-card p-4 text-start hover:border-primary"
              >
                <span className="grid size-10 place-items-center rounded-full text-sm font-semibold text-white" style={{ background: m.color }}>
                  {initials(m.name)}
                </span>
                <div>
                  <p className="font-medium">{m.name}</p>
                  {pick(m.title) ? <p className="text-xs text-muted-foreground">{pick(m.title)}</p> : null}
                </div>
              </button>
            </li>
          ))}
        </ul>
      ) : step === "time" && service ? (
        <>
          <SlotPicker
            slug={slug}
            serviceId={service.id}
            staffId={staffId}
            tz={tz}
            value={slot?.start ?? null}
            refreshKey={refreshKey}
            onChange={(s) => {
              setSlot(s);
              setStep("details");
            }}
          />
        </>
      ) : step === "details" ? (
        <form
          className="grid gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <Field label={t("booking.fullName")} htmlFor="bk-name">
            <Input id="bk-name" required minLength={2} autoComplete="name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </Field>
          <Field label={t("booking.phone")} hint={t("booking.phoneHint")} htmlFor="bk-phone">
            <Input
              id="bk-phone"
              required
              inputMode="tel"
              autoComplete="tel"
              dir="ltr"
              placeholder="+961 3 123 456"
              value={form.phone}
              onChange={(e) => setForm({ ...form, phone: e.target.value })}
            />
          </Field>
          <Field label={t("booking.notes")} htmlFor="bk-notes">
            <Textarea id="bk-notes" rows={2} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
          </Field>
          <input
            type="text"
            name="website"
            tabIndex={-1}
            autoComplete="off"
            className="hidden"
            value={form.website}
            onChange={(e) => setForm({ ...form, website: e.target.value })}
            aria-hidden
          />
          <label className="flex items-start gap-2 text-xs text-muted-foreground">
            <Checkbox checked={form.marketing} onChange={(e) => setForm({ ...form, marketing: e.target.checked })} className="mt-0.5" />
            {t("booking.marketingConsent")}
          </label>
          <p className="text-[11px] leading-relaxed text-muted-foreground">{t("booking.consent", { business: businessName })}</p>
          <Button type="submit" size="lg" disabled={submitting} className={cn("w-full")}>
            {submitting ? t("booking.booking") : t("booking.book")}
          </Button>
        </form>
      ) : null}
    </div>
  );
}
