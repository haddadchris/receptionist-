"use client";

import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

/** Two panes on desktop; on phones show either the list or the open thread. */
export function InboxPanes({ list, children }: { list: React.ReactNode; children: React.ReactNode }) {
  const pathname = usePathname();
  const inThread = pathname !== "/dashboard/inbox";
  return (
    <div className="-mx-4 -mt-4 grid h-[calc(100dvh-3.5rem-5rem)] min-h-0 md:-mx-6 md:h-[calc(100dvh-3.5rem)] md:grid-cols-[320px_1fr]">
      <aside className={cn("min-h-0 border-e bg-card", inThread && "hidden md:block")}>{list}</aside>
      <section className={cn("min-h-0", !inThread && "hidden md:block")}>{children}</section>
    </div>
  );
}
