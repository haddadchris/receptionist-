"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useT } from "@/i18n/client";
import type { TKey } from "@/i18n";
import { cn } from "@/lib/utils";

/** Admin sections; later phases append (leads). */
export const ADMIN_LINKS: { href: string; label: TKey }[] = [
  { href: "/admin", label: "admin.businesses" },
  { href: "/admin/invoices", label: "admin.invoices" },
  { href: "/admin/plans", label: "admin.plans" },
];

export function AdminNav() {
  const t = useT();
  const pathname = usePathname();
  return (
    <nav className="scrollbar-none -mb-px flex gap-4 overflow-x-auto text-sm">
      {ADMIN_LINKS.map((l) => {
        const active = l.href === "/admin" ? pathname === "/admin" || pathname.startsWith("/admin/businesses") : pathname.startsWith(l.href);
        return (
          <Link key={l.href} href={l.href} className={cn("border-b-2 py-2 whitespace-nowrap", active ? "border-primary font-medium text-primary" : "border-transparent text-muted-foreground")}>
            {t(l.label)}
          </Link>
        );
      })}
    </nav>
  );
}
