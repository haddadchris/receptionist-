"use client";

import { useEffect, useMemo, useState } from "react";
import { DateTime } from "luxon";
import { useI18n } from "@/i18n/client";
import { cn } from "@/lib/utils";
import { fmtTime, intlLocale } from "@/lib/format";

export type PublicSlot = { start: string; end: string; staffIds: string[] };

/** Date strip + time grid. Fetches 14 days of slots at a time from the public API. */
export function SlotPicker({
  slug,
  serviceId,
  staffId,
  tz,
  value,
  onChange,
  refreshKey,
}: {
  slug: string;
  serviceId: string;
  staffId: string | null;
  tz: string;
  value: string | null;
  onChange: (slot: PublicSlot) => void;
  refreshKey?: number;
}) {
  const { t, locale } = useI18n();
  const [from, setFrom] = useState(() => DateTime.now().setZone(tz).toISODate()!);
  const [slots, setSlots] = useState<PublicSlot[] | null>(null);
  const [day, setDay] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setSlots(null);
    const qs = new URLSearchParams({ serviceId, from, days: "14" });
    if (staffId) qs.set("staffId", staffId);
    fetch(`/api/public/${slug}/slots?${qs}`)
      .then((r) => r.json())
      .then((d: { slots?: PublicSlot[] }) => {
        if (cancelled) return;
        const list = d.slots ?? [];
        setSlots(list);
        setDay((cur) => {
          const days = new Set(list.map((s) => DateTime.fromISO(s.start).setZone(tz).toISODate()));
          if (cur && days.has(cur)) return cur;
          return list[0] ? DateTime.fromISO(list[0].start).setZone(tz).toISODate() : null;
        });
      })
      .catch(() => !cancelled && setSlots([]));
    return () => {
      cancelled = true;
    };
  }, [slug, serviceId, staffId, from, tz, refreshKey]);

  const days = useMemo(() => Array.from({ length: 14 }, (_, i) => DateTime.fromISO(from, { zone: tz }).plus({ days: i })), [from, tz]);
  const byDay = useMemo(() => {
    const m = new Map<string, PublicSlot[]>();
    for (const s of slots ?? []) {
      const d = DateTime.fromISO(s.start).setZone(tz).toISODate()!;
      m.set(d, [...(m.get(d) ?? []), s]);
    }
    return m;
  }, [slots, tz]);

  const daySlots = day ? (byDay.get(day) ?? []) : [];
  const groups = [
    { label: t("booking.morning"), list: daySlots.filter((s) => DateTime.fromISO(s.start).setZone(tz).hour < 12) },
    { label: t("booking.afternoon"), list: daySlots.filter((s) => { const h = DateTime.fromISO(s.start).setZone(tz).hour; return h >= 12 && h < 17; }) },
    { label: t("booking.evening"), list: daySlots.filter((s) => DateTime.fromISO(s.start).setZone(tz).hour >= 17) },
  ].filter((g) => g.list.length);

  const today = DateTime.now().setZone(tz).toISODate();
  const canGoBack = from > today!;

  return (
    <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-4">
      <div className="flex min-w-0 items-center gap-1">
        <button
          type="button"
          disabled={!canGoBack}
          onClick={() => setFrom(DateTime.fromISO(from).minus({ days: 14 }).toISODate()! < today! ? today! : DateTime.fromISO(from).minus({ days: 14 }).toISODate()!)}
          className="shrink-0 rounded-md border px-2 py-6 text-sm disabled:opacity-30"
          aria-label={t("calendar.prev")}
        >
          <span className="inline-block rtl:rotate-180">‹</span>
        </button>
        <div className="scrollbar-none flex min-w-0 flex-1 gap-1.5 overflow-x-auto">
          {days.map((d) => {
            const iso = d.toISODate()!;
            const count = byDay.get(iso)?.length ?? 0;
            const active = iso === day;
            return (
              <button
                key={iso}
                type="button"
                disabled={slots !== null && count === 0}
                onClick={() => setDay(iso)}
                className={cn(
                  "flex w-14 shrink-0 flex-col items-center rounded-xl border py-2 text-xs transition-colors disabled:opacity-35",
                  active ? "border-primary bg-primary text-primary-foreground" : "bg-card hover:border-primary/40",
                )}
              >
                <span className="opacity-80">{new Intl.DateTimeFormat(intlLocale(locale), { weekday: "short", timeZone: tz }).format(d.toJSDate())}</span>
                <span className="text-lg font-semibold">{d.day}</span>
                <span className="opacity-80">{new Intl.DateTimeFormat(intlLocale(locale), { month: "short", timeZone: tz }).format(d.toJSDate())}</span>
              </button>
            );
          })}
        </div>
        <button
          type="button"
          onClick={() => setFrom(DateTime.fromISO(from).plus({ days: 14 }).toISODate()!)}
          className="shrink-0 rounded-md border px-2 py-6 text-sm"
          aria-label={t("calendar.next")}
        >
          <span className="inline-block rtl:rotate-180">›</span>
        </button>
      </div>
      {slots === null ? (
        <div className="grid grid-cols-4 gap-2">
          {Array.from({ length: 8 }, (_, i) => (
            <div key={i} className="h-10 animate-pulse rounded-lg bg-muted" />
          ))}
        </div>
      ) : daySlots.length === 0 ? (
        <p className="rounded-lg bg-muted p-4 text-center text-sm text-muted-foreground">{t("booking.noSlots")}</p>
      ) : (
        groups.map((g) => (
          <div key={g.label}>
            <p className="mb-2 text-xs font-medium text-muted-foreground">{g.label}</p>
            <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
              {g.list.map((s) => (
                <button
                  key={s.start}
                  type="button"
                  onClick={() => onChange(s)}
                  className={cn(
                    "ltr-nums h-11 rounded-lg border text-sm font-medium transition-colors",
                    value === s.start ? "border-primary bg-primary text-primary-foreground" : "bg-card hover:border-primary hover:text-primary",
                  )}
                >
                  {fmtTime(s.start, tz, locale)}
                </button>
              ))}
            </div>
          </div>
        ))
      )}
    </div>
  );
}
