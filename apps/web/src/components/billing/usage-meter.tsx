import { cn } from "@/lib/utils";

export function UsageMeter({ label, used, included, caption }: { label: string; used: number; included: number; caption: string }) {
  const pct = included > 0 ? Math.min(100, Math.round((used / included) * 100)) : 0;
  const over = included > 0 && used > included;
  return (
    <div className="grid gap-1.5">
      <div className="flex items-baseline justify-between gap-2 text-sm">
        <span className="font-medium">{label}</span>
        <span className="text-xs text-muted-foreground tabular-nums">{caption}</span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-muted" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label={label}>
        <div className={cn("h-full rounded-full transition-all", over ? "bg-warning" : "bg-primary")} style={{ width: `${included > 0 ? Math.max(pct, used > 0 ? 2 : 0) : 0}%` }} />
      </div>
    </div>
  );
}
