"use client";

import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input, Switch } from "@/components/ui/form";
import { useI18n } from "@/i18n/client";
import { dictionaries } from "@/i18n";

export type Rule = { weekday: number; start: string; end: string };

/** Edit weekly hours: per weekday a list of [start, end] ranges (split shifts allowed). */
export function WeeklyHoursEditor({ value, onChange, disabled }: { value: Rule[]; onChange: (v: Rule[]) => void; disabled?: boolean }) {
  const { t, locale } = useI18n();
  const names = dictionaries[locale].weekdays.long;
  const byDay = (d: number) => value.filter((r) => r.weekday === d);
  const setDay = (d: number, rules: Rule[]) => onChange([...value.filter((r) => r.weekday !== d), ...rules].sort((a, b) => a.weekday - b.weekday || a.start.localeCompare(b.start)));

  return (
    <div className="divide-y rounded-lg border">
      {[1, 2, 3, 4, 5, 6, 7].map((d) => {
        const rules = byDay(d);
        const open = rules.length > 0;
        return (
          <div key={d} className="flex flex-wrap items-start gap-3 p-2.5">
            <label className="flex w-32 items-center gap-2 pt-1.5 text-sm font-medium">
              <Switch
                checked={open}
                disabled={disabled}
                onCheckedChange={(v) => setDay(d, v ? [{ weekday: d, start: "09:00", end: "17:00" }] : [])}
              />
              {names[d - 1]}
            </label>
            <div className="grid flex-1 gap-1.5">
              {!open ? (
                <span className="pt-1.5 text-sm text-muted-foreground">{t("hours.closed")}</span>
              ) : (
                rules.map((r, i) => (
                  <div key={i} className="flex items-center gap-1.5">
                    <Input
                      type="time"
                      step={300}
                      className="h-9 w-28"
                      value={r.start}
                      disabled={disabled}
                      onChange={(e) => setDay(d, rules.map((x, j) => (j === i ? { ...x, start: e.target.value } : x)))}
                    />
                    <span className="text-muted-foreground">–</span>
                    <Input
                      type="time"
                      step={300}
                      className="h-9 w-28"
                      value={r.end}
                      disabled={disabled}
                      onChange={(e) => setDay(d, rules.map((x, j) => (j === i ? { ...x, end: e.target.value } : x)))}
                    />
                    {!disabled ? (
                      i === 0 ? (
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-sm"
                          aria-label={t("hours.addShift")}
                          onClick={() => setDay(d, [...rules, { weekday: d, start: "16:00", end: "19:00" }])}
                        >
                          <Plus />
                        </Button>
                      ) : (
                        <Button type="button" variant="ghost" size="icon-sm" aria-label={t("common.remove")} onClick={() => setDay(d, rules.filter((_, j) => j !== i))}>
                          <Trash2 />
                        </Button>
                      )
                    ) : null}
                  </div>
                ))
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/** Flat list editor for breaks (weekday + range). */
export function BreaksEditor({ value, onChange, disabled }: { value: Rule[]; onChange: (v: Rule[]) => void; disabled?: boolean }) {
  const { t, locale } = useI18n();
  const names = dictionaries[locale].weekdays.long;
  return (
    <div className="grid gap-2">
      {value.map((r, i) => (
        <div key={i} className="flex flex-wrap items-center gap-1.5">
          <select
            className="h-9 rounded-md border bg-background px-2 text-sm"
            value={r.weekday}
            disabled={disabled}
            onChange={(e) => onChange(value.map((x, j) => (j === i ? { ...x, weekday: Number(e.target.value) } : x)))}
          >
            {names.map((n, idx) => (
              <option key={idx} value={idx + 1}>
                {n}
              </option>
            ))}
          </select>
          <Input type="time" step={300} className="h-9 w-28" value={r.start} disabled={disabled} onChange={(e) => onChange(value.map((x, j) => (j === i ? { ...x, start: e.target.value } : x)))} />
          <span className="text-muted-foreground">–</span>
          <Input type="time" step={300} className="h-9 w-28" value={r.end} disabled={disabled} onChange={(e) => onChange(value.map((x, j) => (j === i ? { ...x, end: e.target.value } : x)))} />
          {!disabled ? (
            <Button type="button" variant="ghost" size="icon-sm" onClick={() => onChange(value.filter((_, j) => j !== i))} aria-label={t("common.remove")}>
              <Trash2 />
            </Button>
          ) : null}
        </div>
      ))}
      {!disabled ? (
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="outline" size="sm" onClick={() => onChange([...value, { weekday: 1, start: "13:00", end: "14:00" }])}>
            <Plus /> {t("hours.addBreak")}
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => onChange([...value.filter((v) => !(v.start === "13:00" && v.end === "14:00")), ...[1, 2, 3, 4, 5].map((weekday) => ({ weekday, start: "13:00", end: "14:00" }))])}
          >
            13:00–14:00 × 5
          </Button>
        </div>
      ) : null}
    </div>
  );
}
