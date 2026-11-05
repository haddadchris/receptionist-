import Link from "next/link";
import { cn } from "@/lib/utils";

export function Logo({ className, href = "/" }: { className?: string; href?: string }) {
  return (
    <Link href={href} className={cn("inline-flex items-center gap-2 font-semibold tracking-tight", className)}>
      <span className="grid size-8 place-items-center rounded-lg bg-primary text-primary-foreground">
        <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          <path d="M5 12a7 7 0 0 1 14 0" />
          <path d="M3 12h2m14 0h2" />
          <circle cx="12" cy="15" r="3" />
        </svg>
      </span>
      <span className="text-lg">Fekerte</span>
    </Link>
  );
}
