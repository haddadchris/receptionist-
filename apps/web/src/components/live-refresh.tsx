"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/** Re-fetches server components every `ms` while the tab is visible (simple, serverless-friendly "live" updates). */
export function LiveRefresh({ ms = 4000 }: { ms?: number }) {
  const router = useRouter();
  useEffect(() => {
    const id = setInterval(() => {
      if (document.visibilityState === "visible") router.refresh();
    }, ms);
    return () => clearInterval(id);
  }, [router, ms]);
  return null;
}
