export const OUTCOME_TONE = {
  booked: "success",
  rescheduled: "default",
  cancelled: "muted",
  info: "secondary",
  transferred: "warning",
  message_taken: "warning",
  missed: "destructive",
  abandoned: "muted",
} as const;

export function fmtDuration(s: number | null) {
  if (!s) return "—";
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}
