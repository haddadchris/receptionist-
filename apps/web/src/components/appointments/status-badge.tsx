"use client";

import { Badge } from "@/components/ui/card";
import { useT } from "@/i18n/client";
import type { AppointmentStatus } from "@fekerte/core/db/schema";

const TONES: Record<AppointmentStatus, "warning" | "default" | "muted" | "success" | "destructive"> = {
  pending: "warning",
  confirmed: "default",
  cancelled: "muted",
  completed: "success",
  no_show: "destructive",
};

export const STATUS_BG: Record<AppointmentStatus, string> = {
  pending: "bg-amber-50 border-amber-300 text-amber-950",
  confirmed: "bg-sky-50 border-sky-300 text-sky-950",
  cancelled: "bg-muted border-border text-muted-foreground line-through",
  completed: "bg-emerald-50 border-emerald-300 text-emerald-950",
  no_show: "bg-rose-50 border-rose-300 text-rose-950",
};

export function StatusBadge({ status }: { status: AppointmentStatus }) {
  const t = useT();
  return <Badge tone={TONES[status]}>{t(`status.${status}`)}</Badge>;
}
