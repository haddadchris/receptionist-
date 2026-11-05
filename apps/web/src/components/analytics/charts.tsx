/**
 * Small, dependency-free charts (server-rendered HTML/CSS).
 * Mark specs: bars ≤ 24px, 4px rounded data-end + square baseline, 2px surface
 * gaps between stacked segments, hairline gridlines, text in text tokens
 * (never the series colour), hover/focus tooltip on every mark, table view.
 */
import { cn } from "@/lib/utils";

type Series = { key: string; label: string; color: string };

function niceMax(v: number) {
  if (v <= 5) return Math.max(1, Math.ceil(v));
  const pow = 10 ** Math.floor(Math.log10(v));
  const n = v / pow;
  const step = n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10;
  return step * pow;
}

/** A handful of evenly spaced tick positions (first and last included). */
function tickIndexes(n: number, max = 5): number[] {
  if (n <= max) return Array.from({ length: n }, (_, i) => i);
  return [...new Set(Array.from({ length: max }, (_, k) => Math.round((k * (n - 1)) / (max - 1))))];
}

function Tip({ children }: { children: React.ReactNode }) {
  return (
    <span
      role="tooltip"
      className="pointer-events-none absolute bottom-full start-1/2 z-20 mb-2 hidden w-max max-w-[200px] -translate-x-1/2 rounded-md border bg-popover px-2 py-1 text-xs text-popover-foreground shadow-md group-hover:block group-focus-visible:block rtl:translate-x-1/2"
    >
      {children}
    </span>
  );
}

export function Legend({ series }: { series: Series[] }) {
  return (
    <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
      {series.map((s) => (
        <li key={s.key} className="flex items-center gap-1.5">
          <span className="size-2.5 rounded-[3px]" style={{ background: s.color }} aria-hidden />
          {s.label}
        </li>
      ))}
    </ul>
  );
}

/** Stacked columns over time (e.g. bookings per day: AI vs other channels). */
export function StackedColumns({
  data,
  series,
  height = 160,
  ariaLabel,
}: {
  data: { label: string; tip: string; values: Record<string, number> }[];
  series: Series[];
  height?: number;
  ariaLabel: string;
}) {
  const totals = data.map((d) => series.reduce((s, x) => s + (d.values[x.key] ?? 0), 0));
  const max = niceMax(Math.max(1, ...totals));
  return (
    <figure className="grid gap-2" aria-label={ariaLabel}>
      <div className="relative flex gap-2">
        <div className="flex flex-col justify-between text-end text-[10px] tabular-nums text-muted-foreground" style={{ height }}>
          <span>{max}</span>
          <span>{max / 2}</span>
          <span>0</span>
        </div>
        <div className="relative min-w-0 flex-1" style={{ height }}>
          {[0, 0.5, 1].map((f) => (
            <div key={f} className="absolute inset-x-0 h-px" style={{ top: `${f * 100}%`, background: f === 1 ? "var(--viz-axis)" : "var(--viz-grid)" }} />
          ))}
          <div className="absolute inset-0 flex items-end">
            {data.map((d, i) => (
              <div key={d.label} className="group relative flex h-full flex-1 items-end justify-center outline-none" tabIndex={0} aria-label={d.tip}>
                <div className="flex w-full max-w-[24px] flex-col-reverse gap-[2px]" style={{ height: `${(totals[i]! / max) * 100}%` }}>
                  {series.map((s, si) => {
                    const v = d.values[s.key] ?? 0;
                    if (!v) return null;
                    const isTop = series.slice(si + 1).every((x) => !(d.values[x.key] ?? 0));
                    return <div key={s.key} className={cn("min-h-[2px] w-full", isTop && "rounded-t-[4px]")} style={{ flexGrow: v, background: s.color }} />;
                  })}
                </div>
                <Tip>{d.tip}</Tip>
              </div>
            ))}
          </div>
        </div>
      </div>
      <div className="flex gap-2 text-[10px] text-muted-foreground">
        <span className="invisible tabular-nums" aria-hidden>
          {max}
        </span>
        <div className="relative h-3 flex-1">
          {tickIndexes(data.length).map((i) => (
            <span key={i} className="absolute top-0 -translate-x-1/2 whitespace-nowrap rtl:translate-x-1/2" style={{ insetInlineStart: `${((i + 0.5) / data.length) * 100}%` }}>
              {data[i]!.label}
            </span>
          ))}
        </div>
      </div>
    </figure>
  );
}

/** Horizontal bars, single series, value at the tip. */
export function BarList({ rows, color = "var(--viz-1)" }: { rows: { label: string; value: number; display: string; tip: string }[]; color?: string }) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  return (
    <ul className="grid gap-2.5">
      {rows.map((r) => (
        <li key={r.label} className="group relative grid grid-cols-[minmax(0,7rem)_1fr] items-center gap-3 outline-none" tabIndex={0} aria-label={r.tip}>
          <span className="truncate text-sm">{r.label}</span>
          <span className="flex items-center gap-2">
            <span className="h-3.5 rounded-e-[4px]" style={{ width: `${Math.max(1, (r.value / max) * 85)}%`, background: color }} />
            <span className="text-xs font-medium tabular-nums">{r.display}</span>
          </span>
          <Tip>{r.tip}</Tip>
        </li>
      ))}
    </ul>
  );
}

const SEQ = ["var(--viz-seq-0)", "var(--viz-seq-1)", "var(--viz-seq-2)", "var(--viz-seq-3)", "var(--viz-seq-4)", "var(--viz-seq-5)", "var(--viz-seq-6)"];

/** Weekday × hour heatmap on a single-hue sequential ramp. */
export function Heatmap({
  cells,
  rowLabels,
  hours,
  tip,
  legend,
}: {
  cells: { dow: number; hour: number; count: number }[];
  rowLabels: string[];
  hours: number[];
  tip: (dow: number, hour: number, count: number) => string;
  legend: { low: string; high: string };
}) {
  const max = Math.max(1, ...cells.map((c) => c.count));
  const at = (d: number, h: number) => cells.find((c) => c.dow === d && c.hour === h)?.count ?? 0;
  const step = (n: number) => (n === 0 ? 0 : 1 + Math.min(SEQ.length - 2, Math.floor((n / max) * (SEQ.length - 1))));
  return (
    <figure className="grid gap-2">
      <div className="overflow-x-auto">
        <table className="w-full border-separate" style={{ borderSpacing: 2 }}>
          <thead>
            <tr>
              <th />
              {hours.map((h) => (
                <th key={h} className="text-[10px] font-normal text-muted-foreground tabular-nums">
                  {h % 2 === 0 ? h : ""}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rowLabels.map((label, i) => (
              <tr key={label}>
                <th className="pe-1 text-start text-[11px] font-normal text-muted-foreground">{label}</th>
                {hours.map((h) => {
                  const n = at(i + 1, h);
                  return (
                    <td key={h} className="p-0">
                      <div className="group relative h-5 min-w-4 rounded-[3px] outline-none" style={{ background: SEQ[step(n)] }} tabIndex={0} aria-label={tip(i + 1, h, n)}>
                        <Tip>{tip(i + 1, h, n)}</Tip>
                      </div>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
        <span>{legend.low}</span>
        {SEQ.slice(1).map((c) => (
          <span key={c} className="h-2.5 w-4 rounded-[2px]" style={{ background: c }} aria-hidden />
        ))}
        <span>{legend.high}</span>
      </div>
    </figure>
  );
}

/** Thin segmented bar: one whole split into parts (legend names the parts). */
export function SegmentedBar({ parts, ariaLabel }: { parts: { label: string; value: number; color: string; tip: string }[]; ariaLabel: string }) {
  const total = parts.reduce((s, p) => s + p.value, 0);
  return (
    <div className="grid gap-2">
      <div className="flex h-2 gap-[2px]" role="img" aria-label={ariaLabel}>
        {total === 0 ? <div className="flex-1 rounded-full bg-muted" /> : null}
        {parts.map((p) =>
          p.value ? (
            <div key={p.label} className="group relative rounded-full outline-none" style={{ flexGrow: p.value, background: p.color }} tabIndex={0} aria-label={p.tip}>
              <Tip>{p.tip}</Tip>
            </div>
          ) : null,
        )}
      </div>
      <Legend series={parts.map((p) => ({ key: p.label, label: p.label, color: p.color }))} />
    </div>
  );
}

export function TableView({ summary, head, rows }: { summary: string; head: string[]; rows: (string | number)[][] }) {
  return (
    <details className="text-xs">
      <summary className="cursor-pointer text-muted-foreground hover:text-foreground">{summary}</summary>
      <div className="mt-2 max-h-64 overflow-auto">
        <table className="w-full">
          <thead>
            <tr className="border-b text-muted-foreground">
              {head.map((h) => (
                <th key={h} className="py-1 text-start font-medium">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i} className="border-b last:border-0">
                {r.map((c, j) => (
                  <td key={j} className={cn("py-1", j > 0 && "tabular-nums")}>
                    {c}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );
}
