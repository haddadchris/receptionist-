"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { CalendarClock, Check, MessageCircle, Phone, UserX, X } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox, Field, Input, Textarea } from "@/components/ui/form";
import { Badge } from "@/components/ui/card";
import { StatusBadge } from "./status-badge";
import { useI18n } from "@/i18n/client";
import type { ApptDTO } from "@/lib/dto";
import { fmtDate, fmtPrice, fmtTime, localClockOf, localDateOf, localToIso } from "@/lib/format";
import { cancelAppointmentAction, moveAppointmentAction, setStatusAction } from "@/app/dashboard/actions";

export function AppointmentSheet({
  appt,
  tz,
  open,
  onOpenChange,
  readOnly,
}: {
  appt: ApptDTO | null;
  tz: string;
  open: boolean;
  onOpenChange: (v: boolean) => void;
  readOnly?: boolean;
}) {
  const { t, locale } = useI18n();
  const router = useRouter();
  const [pending, start] = useTransition();
  const [mode, setMode] = useState<"view" | "cancel" | "reschedule">("view");
  const [reason, setReason] = useState("");
  const [notify, setNotify] = useState(true);
  const [date, setDate] = useState("");
  const [time, setTime] = useState("");

  if (!appt) return null;
  const active = appt.status === "pending" || appt.status === "confirmed";
  const isPast = new Date(appt.startsAt) < new Date();

  const run = (fn: () => Promise<{ ok: boolean; error?: string }>, success: string) =>
    start(async () => {
      const res = await fn();
      if (res.ok) {
        toast.success(success);
        setMode("view");
        onOpenChange(false);
        router.refresh();
      } else toast.error(res.error ?? t("common.error"));
    });

  const wa = `https://wa.me/${appt.customerPhone.replace("+", "")}`;

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!v) setMode("view");
        onOpenChange(v);
      }}
    >
      <DialogContent>
        <DialogHeader>
          <div className="flex items-center gap-2">
            <span className="size-3 rounded-full" style={{ background: appt.staffColor }} />
            <DialogTitle>{appt.serviceName}</DialogTitle>
          </div>
          <DialogDescription>
            {fmtDate(appt.startsAt, tz, locale, { weekday: "long", day: "numeric", month: "long" })} ·{" "}
            <span className="ltr-nums">
              {fmtTime(appt.startsAt, tz, locale)} – {fmtTime(appt.endsAt, tz, locale)}
            </span>
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-3 text-sm">
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge status={appt.status} />
            <Badge tone="outline">{t(`source.${appt.source}`)}</Badge>
            {appt.priceCents !== null ? <Badge tone="secondary">{fmtPrice(appt.priceCents)}</Badge> : null}
          </div>
          <div className="rounded-lg border p-3">
            <div className="flex items-center justify-between gap-2">
              <div className="min-w-0">
                <Link href={`/dashboard/customers/${appt.customerId}`} className="font-medium hover:underline">
                  {appt.customerName ?? appt.customerPhone}
                </Link>
                <p className="ltr-nums text-xs text-muted-foreground">{appt.customerPhone}</p>
              </div>
              <div className="flex gap-1">
                <Button asChild size="icon-sm" variant="outline" aria-label="WhatsApp">
                  <a href={wa} target="_blank" rel="noreferrer">
                    <MessageCircle />
                  </a>
                </Button>
                <Button asChild size="icon-sm" variant="outline" aria-label="Call">
                  <a href={`tel:${appt.customerPhone}`}>
                    <Phone />
                  </a>
                </Button>
              </div>
            </div>
            <p className="mt-2 text-xs text-muted-foreground">
              {t("appointment.staff")}: <span className="text-foreground">{appt.staffName}</span>
            </p>
          </div>
          {appt.notes ? (
            <p className="rounded-lg bg-muted p-3">
              <span className="block text-xs text-muted-foreground">{t("appointment.notes")}</span>
              {appt.notes}
            </p>
          ) : null}
          {appt.internalNotes ? (
            <p className="rounded-lg bg-muted p-3">
              <span className="block text-xs text-muted-foreground">{t("appointment.internalNotes")}</span>
              {appt.internalNotes}
            </p>
          ) : null}
        </div>

        {readOnly ? null : mode === "cancel" ? (
          <div className="grid gap-3">
            <Field label={t("appointment.cancelReason")}>
              <Textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={2} />
            </Field>
            <label className="flex items-center gap-2 text-sm">
              <Checkbox checked={notify} onChange={(e) => setNotify(e.target.checked)} /> {t("appointment.notifyCustomer")}
            </label>
            <div className="flex gap-2">
              <Button variant="ghost" onClick={() => setMode("view")}>
                {t("common.back")}
              </Button>
              <Button
                variant="destructive"
                className="flex-1"
                disabled={pending}
                onClick={() => run(() => cancelAppointmentAction({ id: appt.id, reason, notifyCustomer: notify }), t("appointment.cancelled"))}
              >
                {t("appointment.cancel")}
              </Button>
            </div>
          </div>
        ) : mode === "reschedule" ? (
          <div className="grid gap-3">
            <div className="grid grid-cols-2 gap-2">
              <Field label={t("appointment.date")}>
                <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
              </Field>
              <Field label={t("appointment.time")}>
                <Input type="time" step={300} value={time} onChange={(e) => setTime(e.target.value)} />
              </Field>
            </div>
            <div className="flex gap-2">
              <Button variant="ghost" onClick={() => setMode("view")}>
                {t("common.back")}
              </Button>
              <Button
                className="flex-1"
                disabled={pending || !date || !time}
                onClick={() =>
                  run(() => moveAppointmentAction({ id: appt.id, startsAt: localToIso(date, time, tz), staffId: appt.staffId }), t("calendar.moved"))
                }
              >
                {t("appointment.reschedule")}
              </Button>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-2">
            {appt.status === "pending" ? (
              <Button disabled={pending} onClick={() => run(() => setStatusAction({ id: appt.id, status: "confirmed" }), t("appointment.updated"))}>
                <Check /> {t("appointment.confirm")}
              </Button>
            ) : null}
            {active || appt.status === "no_show" ? (
              <Button
                variant="success"
                disabled={pending}
                onClick={() => run(() => setStatusAction({ id: appt.id, status: "completed" }), t("appointment.updated"))}
              >
                <Check /> {t("appointment.complete")}
              </Button>
            ) : null}
            {(active && isPast) || appt.status === "completed" ? (
              <Button variant="outline" disabled={pending} onClick={() => run(() => setStatusAction({ id: appt.id, status: "no_show" }), t("appointment.updated"))}>
                <UserX /> {t("appointment.noShow")}
              </Button>
            ) : null}
            {active ? (
              <>
                <Button
                  variant="outline"
                  onClick={() => {
                    setDate(localDateOf(appt.startsAt, tz));
                    setTime(localClockOf(appt.startsAt, tz));
                    setMode("reschedule");
                  }}
                >
                  <CalendarClock /> {t("appointment.reschedule")}
                </Button>
                <Button variant="outline" className="text-destructive" onClick={() => setMode("cancel")}>
                  <X /> {t("appointment.cancel")}
                </Button>
              </>
            ) : null}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
