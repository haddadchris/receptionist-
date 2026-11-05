"use client";

import { useState } from "react";
import { useI18n } from "@/i18n/client";
import type { ApptDTO } from "@/lib/dto";
import { fmtDate, fmtTime } from "@/lib/format";
import { StatusBadge } from "./status-badge";
import { AppointmentSheet } from "./appointment-sheet";
import { EmptyState } from "@/components/ui/card";

export function AppointmentList({
  appointments,
  tz,
  showDate = true,
  readOnly,
  emptyText,
}: {
  appointments: ApptDTO[];
  tz: string;
  showDate?: boolean;
  readOnly?: boolean;
  emptyText?: string;
}) {
  const { t, locale } = useI18n();
  const [selected, setSelected] = useState<ApptDTO | null>(null);
  if (!appointments.length) return <EmptyState title={emptyText ?? t("appointments.empty")} />;
  return (
    <>
      <ul className="divide-y rounded-xl border bg-card">
        {appointments.map((a) => (
          <li key={a.id}>
            <button type="button" onClick={() => setSelected(a)} className="flex w-full items-center gap-3 p-3 text-start hover:bg-accent/50">
              <div className="w-16 shrink-0 text-center">
                {showDate ? <div className="text-[11px] text-muted-foreground">{fmtDate(a.startsAt, tz, locale)}</div> : null}
                <div className="ltr-nums text-sm font-semibold">{fmtTime(a.startsAt, tz, locale)}</div>
              </div>
              <span className="h-10 w-1 shrink-0 rounded-full" style={{ background: a.staffColor }} />
              <div className="min-w-0 flex-1">
                <div className="truncate font-medium">{a.customerName ?? a.customerPhone}</div>
                <div className="truncate text-xs text-muted-foreground">
                  {a.serviceName} · {a.staffName} · {t(`source.${a.source}`)}
                </div>
              </div>
              <StatusBadge status={a.status} />
            </button>
          </li>
        ))}
      </ul>
      <AppointmentSheet appt={selected} tz={tz} open={!!selected} onOpenChange={(v) => !v && setSelected(null)} readOnly={readOnly} />
    </>
  );
}
