"use client";

import { useState } from "react";
import { useI18n } from "@/i18n/client";

function Slider({
  id,
  label,
  value,
  min,
  max,
  step = 1,
  prefix = "",
  suffix = "",
  onChange,
}: {
  id: string;
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  prefix?: string;
  suffix?: string;
  onChange: (v: number) => void;
}) {
  return (
    <div className="grid gap-1.5">
      <div className="flex items-baseline justify-between gap-2">
        <label htmlFor={id} className="text-sm">
          {label}
        </label>
        <span className="text-sm font-semibold tabular-nums" dir="ltr">
          {prefix}
          {value}
          {suffix}
        </span>
      </div>
      <input id={id} type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} className="w-full accent-[var(--primary)]" />
    </div>
  );
}

/** Lebanese convention for USD in every language: "$2,400". */
const usd = (n: number) => "$" + Math.round(n).toLocaleString("en-US");

/** Missed calls/day × booking rate × average value × working days → estimated monthly loss. */
export function RoiCalculator({ premiumMonthlyCents }: { premiumMonthlyCents: number }) {
  const { t } = useI18n();
  const [missed, setMissed] = useState(5);
  const [value, setValue] = useState(50);
  const [rate, setRate] = useState(40);
  const [days, setDays] = useState(24);
  const monthly = Math.round(missed * days * (rate / 100) * value);
  const multiple = premiumMonthlyCents > 0 ? monthly / (premiumMonthlyCents / 100) : 0;
  return (
    <div className="grid gap-6 rounded-2xl border bg-card p-5 shadow-sm sm:p-6 md:grid-cols-[1fr_minmax(0,18rem)]" data-testid="roi-calculator">
      <div className="grid gap-5">
        <Slider id="roi-missed" label={t("marketing.roi.missedCalls")} value={missed} min={1} max={30} onChange={setMissed} />
        <Slider id="roi-value" label={t("marketing.roi.avgValue")} value={value} min={10} max={500} step={5} prefix="$" onChange={setValue} />
        <Slider id="roi-rate" label={t("marketing.roi.bookRate")} value={rate} min={5} max={100} step={5} suffix="%" onChange={setRate} />
        <Slider id="roi-days" label={t("marketing.roi.workingDays")} value={days} min={10} max={30} onChange={setDays} />
      </div>
      <div className="grid content-center gap-2 rounded-xl bg-primary/8 p-5 text-center">
        <p className="text-sm text-muted-foreground">{t("marketing.roi.result")}</p>
        <p className="text-4xl font-bold text-primary" data-testid="roi-monthly" dir="ltr">
          {usd(monthly)}
        </p>
        <p className="text-sm">{t("marketing.roi.perYear", { amount: usd(monthly * 12) })}</p>
        {multiple >= 1 ? <p className="text-sm font-medium">{t("marketing.roi.payback", { x: String(Math.round(multiple * 10) / 10) })}</p> : null}
        <p className="mt-2 text-xs text-muted-foreground">{t("marketing.roi.assumptions")}</p>
      </div>
    </div>
  );
}
