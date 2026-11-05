"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { CalendarClock, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/i18n/client";
import { fmtDate, fmtTime } from "@/lib/format";
import { StatusBadge } from "@/components/appointments/status-badge";
import { SlotPicker, type PublicSlot } from "./slot-picker";
import type { AppointmentStatus } from "@fekerte/core/db/schema";

export function ManageAppointment({
  token,
  slug,
  tz,
  appt,
  canChange,
}: {
  token: string;
  slug: string;
  tz: string;
  appt: { serviceId: string; serviceName: string; staffName: string; staffId: string; startsAt: string; status: AppointmentStatus };
  canChange: boolean;
}) {
  const { t, locale } = useI18n();
  const router = useRouter();
  const [mode, setMode] = useState<"view" | "cancel" | "reschedule">("view");
  const [busy, setBusy] = useState(false);
  const [slot, setSlot] = useState<PublicSlot | null>(null);
  const active = appt.status === "pending" || appt.status === "confirmed";

  const call = async (payload: Record<string, unknown>, ok: string) => {
    setBusy(true);
    try {
      const res = await fetch(`/api/public/manage/${token}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      const data = await res.json();
      if (res.ok) {
        toast.success(ok);
        setMode("view");
        router.refresh();
      } else if (data.code === "TOO_LATE") toast.error(t("manage.tooLate"));
      else if (data.code === "SLOT_UNAVAILABLE") toast.error(t("booking.slotTaken"));
      else toast.error(data.error ?? t("common.error"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="grid gap-4">
      <div className="rounded-xl border bg-card p-4">
        <div className="flex items-start justify-between gap-2">
          <div>
            <p className="font-semibold">{appt.serviceName}</p>
            <p className="text-sm text-muted-foreground">
              {fmtDate(appt.startsAt, tz, locale, { weekday: "long", day: "numeric", month: "long" })} · <span className="ltr-nums">{fmtTime(appt.startsAt, tz, locale)}</span>
            </p>
            <p className="text-sm text-muted-foreground">
              {t("booking.with")} {appt.staffName}
            </p>
          </div>
          <StatusBadge status={appt.status} />
        </div>
      </div>

      {!active ? (
        <Button asChild>
          <a href={`/b/${slug}`}>{t("manage.bookAgain")}</a>
        </Button>
      ) : !canChange ? (
        <p className="rounded-lg bg-warning/15 p-3 text-sm">{t("manage.tooLate")}</p>
      ) : mode === "view" ? (
        <div className="grid gap-2 sm:grid-cols-2">
          <Button variant="outline" onClick={() => setMode("reschedule")}>
            <CalendarClock /> {t("manage.reschedule")}
          </Button>
          <Button variant="outline" className="text-destructive" onClick={() => setMode("cancel")}>
            <X /> {t("manage.cancel")}
          </Button>
        </div>
      ) : mode === "cancel" ? (
        <div className="grid gap-2 sm:grid-cols-2">
          <Button variant="ghost" onClick={() => setMode("view")}>
            {t("manage.keep")}
          </Button>
          <Button variant="destructive" disabled={busy} onClick={() => call({ action: "cancel" }, t("manage.cancelled"))}>
            {t("manage.cancelConfirm")}
          </Button>
        </div>
      ) : (
        <div className="grid gap-3">
          <SlotPicker slug={slug} serviceId={appt.serviceId} staffId={appt.staffId} tz={tz} value={slot?.start ?? null} onChange={setSlot} />
          <div className="grid gap-2 sm:grid-cols-2">
            <Button variant="ghost" onClick={() => setMode("view")}>
              {t("common.back")}
            </Button>
            <Button disabled={!slot || busy} onClick={() => slot && call({ action: "reschedule", startsAt: slot.start, staffId: appt.staffId }, t("manage.rescheduled"))}>
              {t("common.confirm")}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
