"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { DateTime } from "luxon";
import { toast } from "sonner";
import { ChevronLeft, ChevronRight, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/form";
import { useI18n } from "@/i18n/client";
import type { ApptDTO, ServiceOption, StaffOption } from "@/lib/dto";
import { fmtLocalDate, fmtTime, todayIn } from "@/lib/format";
import { cn } from "@/lib/utils";
import { STATUS_BG } from "@/components/appointments/status-badge";
import { AppointmentSheet } from "@/components/appointments/appointment-sheet";
import { NewAppointmentDialog, type NewAppointmentDefaults } from "@/components/appointments/new-appointment-dialog";
import { moveAppointmentAction } from "@/app/dashboard/actions";

const PX_PER_MIN = 1.2;
const SNAP = 15;

type Column = { key: string; date: string; staffId: string | null; label: string; sublabel?: string; color?: string };

export type CalendarProps = {
  view: "day" | "week";
  date: string;
  days: string[];
  tz: string;
  staff: StaffOption[];
  selectedStaffId: string | null;
  appointments: ApptDTO[];
  /** Working windows per `${date}|${staffId}` as ISO pairs. */
  windows: Record<string, { start: string; end: string }[]>;
  services: ServiceOption[];
  readOnly?: boolean;
};

const minutesOfDay = (iso: string, tz: string, date: string) => {
  const dt = DateTime.fromISO(iso).setZone(tz);
  const midnight = DateTime.fromISO(date, { zone: tz }).startOf("day");
  return Math.round(dt.diff(midnight, "minutes").minutes);
};

const clockOf = (min: number) => `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;

export function Calendar(props: CalendarProps) {
  const { t, locale } = useI18n();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [, startTransition] = useTransition();
  const [appts, setAppts] = useState(props.appointments);
  useEffect(() => setAppts(props.appointments), [props.appointments]);

  const [selected, setSelected] = useState<ApptDTO | null>(null);
  const [newDefaults, setNewDefaults] = useState<NewAppointmentDefaults | null>(null);
  const today = todayIn(props.tz);

  const columns: Column[] = useMemo(() => {
    if (props.view === "day") {
      const list = props.selectedStaffId ? props.staff.filter((s) => s.id === props.selectedStaffId) : props.staff;
      return list.map((s) => ({ key: `${props.date}|${s.id}`, date: props.date, staffId: s.id, label: s.name, color: s.color }));
    }
    return props.days.map((d) => ({
      key: `${d}|${props.selectedStaffId ?? "*"}`,
      date: d,
      staffId: props.selectedStaffId,
      label: fmtLocalDate(d, locale, { weekday: "short" }),
      sublabel: fmtLocalDate(d, locale, { day: "numeric", month: "short" }),
    }));
  }, [props.view, props.date, props.days, props.staff, props.selectedStaffId, locale]);

  const visible = useMemo(() => appts.filter((a) => a.status !== "cancelled"), [appts]);

  const colAppts = (col: Column) =>
    visible.filter((a) => {
      const d = DateTime.fromISO(a.startsAt).setZone(props.tz).toISODate();
      return d === col.date && (col.staffId === null || a.staffId === col.staffId);
    });

  const windowsFor = (col: Column): [number, number][] => {
    const staffIds = col.staffId ? [col.staffId] : props.staff.map((s) => s.id);
    return staffIds.flatMap((id) =>
      (props.windows[`${col.date}|${id}`] ?? []).map((w) => [minutesOfDay(w.start, props.tz, col.date), minutesOfDay(w.end, props.tz, col.date)] as [number, number]),
    );
  };

  // Grid bounds: cover working hours and every visible appointment, at least 08:00–19:00.
  const [gridStart, gridEnd] = useMemo(() => {
    let lo = 8 * 60;
    let hi = 19 * 60;
    for (const col of columns) {
      for (const [a, b] of windowsFor(col)) {
        lo = Math.min(lo, a);
        hi = Math.max(hi, b);
      }
      for (const a of colAppts(col)) {
        lo = Math.min(lo, minutesOfDay(a.startsAt, props.tz, col.date));
        hi = Math.max(hi, minutesOfDay(a.endsAt, props.tz, col.date));
      }
    }
    return [Math.max(0, Math.floor(lo / 60) * 60), Math.min(24 * 60, Math.ceil(hi / 60) * 60)];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [columns, visible, props.windows]);

  const height = (gridEnd - gridStart) * PX_PER_MIN;

  // ---- navigation -----------------------------------------------------------
  const nav = (patch: Record<string, string | null>) => {
    const sp = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(patch)) {
      if (v === null) sp.delete(k);
      else sp.set(k, v);
    }
    router.push(`${pathname}?${sp.toString()}`);
  };
  const shift = (dir: number) => {
    const d = DateTime.fromISO(props.date).plus(props.view === "day" ? { days: dir } : { weeks: dir });
    nav({ date: d.toISODate()! });
  };

  // ---- drag & drop ------------------------------------------------------------
  const drag = useRef<{
    id: string;
    pointerId: number;
    x: number;
    y: number;
    offsetMin: number;
    moved: boolean;
    col: Column;
    startMin: number;
  } | null>(null);
  const [ghost, setGhost] = useState<{ id: string; colKey: string; startMin: number } | null>(null);
  const colByKey = useMemo(() => new Map(columns.map((c) => [c.key, c])), [columns]);

  const columnAt = (x: number, y: number) => {
    for (const el of document.elementsFromPoint(x, y)) {
      const key = (el as HTMLElement).dataset?.col;
      if (key) return { col: colByKey.get(key)!, rect: el.getBoundingClientRect() };
    }
    return null;
  };

  const onBlockPointerDown = (e: React.PointerEvent, a: ApptDTO, col: Column) => {
    e.stopPropagation();
    const startMin = minutesOfDay(a.startsAt, props.tz, col.date);
    const target = columnAt(e.clientX, e.clientY);
    const pointerMin = target ? (e.clientY - target.rect.top) / PX_PER_MIN + gridStart : startMin;
    drag.current = { id: a.id, pointerId: e.pointerId, x: e.clientX, y: e.clientY, offsetMin: pointerMin - startMin, moved: false, col, startMin };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };

  const draggable = (a: ApptDTO) => !props.readOnly && (a.status === "pending" || a.status === "confirmed");

  const onBlockPointerMove = (e: React.PointerEvent, a: ApptDTO) => {
    const d = drag.current;
    if (!d || d.pointerId !== e.pointerId || !draggable(a)) return;
    if (!d.moved && Math.hypot(e.clientX - d.x, e.clientY - d.y) < 6) return;
    d.moved = true;
    const target = columnAt(e.clientX, e.clientY);
    if (!target) return;
    const raw = (e.clientY - target.rect.top) / PX_PER_MIN + gridStart - d.offsetMin;
    const snapped = Math.max(gridStart, Math.min(gridEnd - SNAP, Math.round(raw / SNAP) * SNAP));
    setGhost({ id: a.id, colKey: target.col.key, startMin: snapped });
  };

  const onBlockPointerUp = (e: React.PointerEvent, a: ApptDTO) => {
    const d = drag.current;
    drag.current = null;
    if (!d || d.pointerId !== e.pointerId) return;
    if (!d.moved) {
      setGhost(null);
      setSelected(a);
      return;
    }
    const g = ghost;
    setGhost(null);
    if (!g) return;
    const col = colByKey.get(g.colKey)!;
    const startsAt = DateTime.fromISO(`${col.date}T${clockOf(g.startMin)}`, { zone: props.tz }).toUTC().toISO()!;
    const staffId = col.staffId ?? a.staffId;
    if (startsAt === a.startsAt && staffId === a.staffId) return;
    const duration = Date.parse(a.endsAt) - Date.parse(a.startsAt);
    const prev = appts;
    const staffMember = props.staff.find((s) => s.id === staffId);
    setAppts((list) =>
      list.map((x) =>
        x.id === a.id
          ? { ...x, startsAt, endsAt: new Date(Date.parse(startsAt) + duration).toISOString(), staffId, staffName: staffMember?.name ?? x.staffName, staffColor: staffMember?.color ?? x.staffColor }
          : x,
      ),
    );
    startTransition(async () => {
      const res = await moveAppointmentAction({ id: a.id, startsAt, staffId, override: true });
      if (res.ok) {
        toast.success(t("calendar.moved"));
        router.refresh();
      } else {
        setAppts(prev);
        toast.error(res.error);
      }
    });
  };

  const onColumnClick = (e: React.MouseEvent, col: Column) => {
    if (props.readOnly) return;
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const min = Math.floor(((e.clientY - rect.top) / PX_PER_MIN + gridStart) / SNAP) * SNAP;
    setNewDefaults({ date: col.date, time: clockOf(min), staffId: col.staffId });
  };

  // ---- lanes for overlapping appointments within a column -----------------------
  const layout = (list: ApptDTO[], col: Column) => {
    const items = list
      .map((a) => ({ a, s: minutesOfDay(a.startsAt, props.tz, col.date), e: minutesOfDay(a.endsAt, props.tz, col.date) }))
      .sort((x, y) => x.s - y.s || y.e - x.e);
    const laneEnds: number[] = [];
    const placed = items.map((it) => {
      let lane = laneEnds.findIndex((end) => end <= it.s);
      if (lane === -1) {
        lane = laneEnds.length;
        laneEnds.push(it.e);
      } else laneEnds[lane] = it.e;
      return { ...it, lane };
    });
    return placed.map((p) => {
      const concurrent = placed.filter((q) => q.s < p.e && p.s < q.e);
      const lanes = Math.max(...concurrent.map((q) => q.lane)) + 1;
      return { ...p, lanes };
    });
  };

  const nowMin = minutesOfDay(new Date().toISOString(), props.tz, today);
  const title =
    props.view === "day"
      ? fmtLocalDate(props.date, locale, { weekday: "long", day: "numeric", month: "long" })
      : `${fmtLocalDate(props.days[0]!, locale, { day: "numeric", month: "short" })} – ${fmtLocalDate(props.days.at(-1)!, locale, { day: "numeric", month: "short", year: "numeric" })}`;

  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-1">
          <Button variant="outline" size="icon-sm" onClick={() => shift(-1)} aria-label={t("calendar.prev")}>
            <ChevronLeft className="rtl:rotate-180" />
          </Button>
          <Button variant="outline" size="sm" onClick={() => nav({ date: today })}>
            {t("common.today")}
          </Button>
          <Button variant="outline" size="icon-sm" onClick={() => shift(1)} aria-label={t("calendar.next")}>
            <ChevronRight className="rtl:rotate-180" />
          </Button>
        </div>
        <h2 className="min-w-0 flex-1 truncate text-base font-semibold">{title}</h2>
        <div className="flex items-center gap-2">
          <div className="inline-flex rounded-md border p-0.5">
            {(["day", "week"] as const).map((v) => (
              <button
                key={v}
                onClick={() => nav({ view: v })}
                className={cn("rounded px-3 py-1 text-sm", props.view === v ? "bg-primary text-primary-foreground" : "text-muted-foreground")}
              >
                {t(`calendar.${v}`)}
              </button>
            ))}
          </div>
          <Select className="h-8 w-36 py-0" value={props.selectedStaffId ?? ""} onChange={(e) => nav({ staff: e.target.value || null })}>
            <option value="">{t("calendar.allStaff")}</option>
            {props.staff.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </Select>
          {!props.readOnly ? (
            <Button size="sm" onClick={() => setNewDefaults({ date: props.date, staffId: props.selectedStaffId })}>
              <Plus /> <span className="hidden sm:inline">{t("calendar.newAppointment")}</span>
            </Button>
          ) : null}
        </div>
      </div>
      <p className="text-xs text-muted-foreground">{t("calendar.dragHint")}</p>

      <div className="overflow-x-auto rounded-xl border bg-card">
        <div className="flex min-w-fit">
          {/* time gutter */}
          <div className="sticky start-0 z-20 w-14 shrink-0 border-e bg-card">
            <div className="h-12 border-b" />
            <div className="relative" style={{ height }}>
              {Array.from({ length: (gridEnd - gridStart) / 60 }, (_, i) => (
                <div key={i} className="ltr-nums absolute end-1.5 -translate-y-1/2 text-[10px] text-muted-foreground" style={{ top: i * 60 * PX_PER_MIN }}>
                  {i === 0 ? "" : clockOf(gridStart + i * 60)}
                </div>
              ))}
            </div>
          </div>
          {columns.map((col) => {
            const items = layout(colAppts(col), col);
            const windows = windowsFor(col);
            const isToday = col.date === today;
            return (
              <div key={col.key} className={cn("min-w-36 flex-1 border-e last:border-e-0", props.view === "week" && "min-w-28")}>
                <div className={cn("sticky top-0 flex h-12 flex-col items-center justify-center border-b px-1 text-center", isToday && "bg-primary/5")}>
                  <div className="flex items-center gap-1.5 text-xs font-medium">
                    {col.color ? <span className="size-2 rounded-full" style={{ background: col.color }} /> : null}
                    <span className="truncate">{col.label}</span>
                  </div>
                  {col.sublabel ? <div className={cn("text-[11px] text-muted-foreground", isToday && "font-semibold text-primary")}>{col.sublabel}</div> : null}
                </div>
                <div data-col={col.key} className="relative cursor-copy bg-muted/60" style={{ height }} onClick={(e) => onColumnClick(e, col)}>
                  {windows.map(([a, b], i) => (
                    <div
                      key={i}
                      className="pointer-events-none absolute inset-x-0 bg-card"
                      style={{ top: (Math.max(a, gridStart) - gridStart) * PX_PER_MIN, height: (Math.min(b, gridEnd) - Math.max(a, gridStart)) * PX_PER_MIN }}
                    />
                  ))}
                  {Array.from({ length: (gridEnd - gridStart) / 30 }, (_, i) => (
                    <div
                      key={i}
                      className={cn("pointer-events-none absolute inset-x-0 border-t", i % 2 === 0 ? "border-border" : "border-dashed border-border/60")}
                      style={{ top: i * 30 * PX_PER_MIN }}
                    />
                  ))}
                  {isToday && nowMin >= gridStart && nowMin <= gridEnd ? (
                    <div className="pointer-events-none absolute inset-x-0 z-10 h-0.5 bg-rose-500" style={{ top: (nowMin - gridStart) * PX_PER_MIN }} />
                  ) : null}
                  {items.map(({ a, s, e, lane, lanes }) => {
                    const isGhost = ghost?.id === a.id;
                    return (
                      <button
                        key={a.id}
                        type="button"
                        onClick={(ev) => ev.stopPropagation()}
                        onPointerDown={(ev) => onBlockPointerDown(ev, a, col)}
                        onPointerMove={(ev) => onBlockPointerMove(ev, a)}
                        onPointerUp={(ev) => onBlockPointerUp(ev, a)}
                        onPointerCancel={() => {
                          drag.current = null;
                          setGhost(null);
                        }}
                        className={cn(
                          "absolute z-10 overflow-hidden rounded-md border border-s-4 px-1.5 py-0.5 text-start text-[11px] leading-tight shadow-xs select-none",
                          STATUS_BG[a.status],
                          draggable(a) ? "cursor-grab touch-none active:cursor-grabbing" : "cursor-pointer",
                          isGhost && "opacity-40",
                        )}
                        style={{
                          top: (s - gridStart) * PX_PER_MIN + 1,
                          height: Math.max(18, (e - s) * PX_PER_MIN - 2),
                          insetInlineStart: `calc(${(lane / lanes) * 100}% + 2px)`,
                          width: `calc(${100 / lanes}% - 4px)`,
                          borderInlineStartColor: a.staffColor,
                        }}
                      >
                        <div className="truncate font-semibold">{a.customerName ?? a.customerPhone}</div>
                        <div className="truncate opacity-80">
                          <span className="ltr-nums">{fmtTime(a.startsAt, props.tz, locale)}</span> · {a.serviceName}
                        </div>
                      </button>
                    );
                  })}
                  {ghost && ghost.colKey === col.key
                    ? (() => {
                        const a = appts.find((x) => x.id === ghost.id)!;
                        const dur = (Date.parse(a.endsAt) - Date.parse(a.startsAt)) / 60000;
                        return (
                          <div
                            className="pointer-events-none absolute inset-x-1 z-20 rounded-md border-2 border-dashed border-primary bg-primary/10 px-1.5 text-[11px] font-semibold text-primary"
                            style={{ top: (ghost.startMin - gridStart) * PX_PER_MIN, height: dur * PX_PER_MIN }}
                          >
                            <span className="ltr-nums">{clockOf(ghost.startMin)}</span>
                          </div>
                        );
                      })()
                    : null}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <AppointmentSheet appt={selected} tz={props.tz} open={!!selected} onOpenChange={(v) => !v && setSelected(null)} readOnly={props.readOnly} />
      {newDefaults ? (
        <NewAppointmentDialog
          open={!!newDefaults}
          onOpenChange={(v) => !v && setNewDefaults(null)}
          services={props.services}
          staff={props.staff}
          tz={props.tz}
          defaults={newDefaults}
        />
      ) : null}
    </div>
  );
}
