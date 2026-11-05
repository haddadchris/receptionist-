"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  BarChart3,
  CalendarDays,
  ClipboardList,
  CreditCard,
  ExternalLink,
  Home,
  Inbox,
  MoreHorizontal,
  Phone,
  Scissors,
  Settings,
  Sparkles,
  Clock,
  Users,
  UserRound,
  Megaphone,
} from "lucide-react";
import { useT } from "@/i18n/client";
import type { TKey } from "@/i18n";
import { cn } from "@/lib/utils";
import { Dialog, DialogContent, DialogTitle, DialogTrigger } from "@/components/ui/dialog";

export type NavFeature = "inbox" | "calls" | "analytics" | "billing" | "campaigns" | "ai";

type Item = { href: string; label: TKey; icon: React.ComponentType<{ className?: string }>; feature?: NavFeature; mobile?: boolean };

const ITEMS: Item[] = [
  { href: "/dashboard", label: "nav.overview", icon: Home, mobile: true },
  { href: "/dashboard/calendar", label: "nav.calendar", icon: CalendarDays, mobile: true },
  { href: "/dashboard/appointments", label: "nav.appointments", icon: ClipboardList },
  { href: "/dashboard/inbox", label: "nav.inbox", icon: Inbox, feature: "inbox", mobile: true },
  { href: "/dashboard/calls", label: "nav.calls", icon: Phone, feature: "calls" },
  { href: "/dashboard/customers", label: "nav.customers", icon: Users, mobile: true },
  { href: "/dashboard/analytics", label: "nav.analytics", icon: BarChart3, feature: "analytics" },
  { href: "/dashboard/campaigns", label: "nav.growth", icon: Megaphone, feature: "campaigns" },
  { href: "/dashboard/ai", label: "nav.ai", icon: Sparkles, feature: "ai" },
  { href: "/dashboard/services", label: "nav.services", icon: Scissors },
  { href: "/dashboard/staff", label: "nav.staff", icon: UserRound },
  { href: "/dashboard/hours", label: "nav.hours", icon: Clock },
  { href: "/dashboard/settings", label: "nav.settings", icon: Settings },
  { href: "/dashboard/billing", label: "nav.billing", icon: CreditCard, feature: "billing" },
];

function useItems(features: NavFeature[]) {
  return ITEMS.filter((i) => !i.feature || features.includes(i.feature));
}

function isActive(pathname: string, href: string) {
  return href === "/dashboard" ? pathname === href : pathname === href || pathname.startsWith(`${href}/`);
}

export function SidebarNav({ features, bookingUrl, unread }: { features: NavFeature[]; bookingUrl: string; unread?: number }) {
  const t = useT();
  const pathname = usePathname();
  const items = useItems(features);
  return (
    <nav className="grid gap-0.5">
      {items.map((item) => {
        const active = isActive(pathname, item.href);
        return (
          <Link
            key={item.href}
            href={item.href}
            className={cn(
              "flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors",
              active ? "bg-primary/10 font-medium text-primary" : "text-muted-foreground hover:bg-accent hover:text-foreground",
            )}
          >
            <item.icon className="size-4" />
            <span className="flex-1">{t(item.label)}</span>
            {item.href === "/dashboard/inbox" && unread ? (
              <span className="rounded-full bg-primary px-1.5 text-[10px] font-semibold text-primary-foreground">{unread}</span>
            ) : null}
          </Link>
        );
      })}
      <a
        href={bookingUrl}
        target="_blank"
        rel="noreferrer"
        className="mt-2 flex items-center gap-3 rounded-lg px-3 py-2 text-sm text-muted-foreground hover:bg-accent hover:text-foreground"
      >
        <ExternalLink className="size-4" />
        {t("nav.bookingPage")}
      </a>
    </nav>
  );
}

export function MobileNav({ features, bookingUrl, unread }: { features: NavFeature[]; bookingUrl: string; unread?: number }) {
  const t = useT();
  const pathname = usePathname();
  const items = useItems(features);
  const primary = items.filter((i) => i.mobile).slice(0, 4);
  const rest = items.filter((i) => !primary.includes(i));
  return (
    <nav className="fixed inset-x-0 bottom-0 z-40 border-t bg-background/95 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden">
      <div className="grid grid-cols-5">
        {primary.map((item) => {
          const active = isActive(pathname, item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn("relative flex flex-col items-center gap-0.5 py-2 text-[11px]", active ? "text-primary" : "text-muted-foreground")}
            >
              <item.icon className="size-5" />
              {t(item.label)}
              {item.href === "/dashboard/inbox" && unread ? (
                <span className="absolute top-1 start-1/2 ms-2 rounded-full bg-primary px-1 text-[9px] text-primary-foreground">{unread}</span>
              ) : null}
            </Link>
          );
        })}
        <Dialog>
          <DialogTrigger className="flex flex-col items-center gap-0.5 py-2 text-[11px] text-muted-foreground">
            <MoreHorizontal className="size-5" />
            {t("common.more")}
          </DialogTrigger>
          <DialogContent side="bottom">
            <DialogTitle className="sr-only">{t("common.more")}</DialogTitle>
            <div className="grid grid-cols-3 gap-2 pt-4">
              {rest.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  className="flex flex-col items-center gap-1 rounded-xl border p-3 text-center text-xs hover:bg-accent"
                >
                  <item.icon className="size-5 text-primary" />
                  {t(item.label)}
                </Link>
              ))}
              <a href={bookingUrl} target="_blank" rel="noreferrer" className="flex flex-col items-center gap-1 rounded-xl border p-3 text-center text-xs hover:bg-accent">
                <ExternalLink className="size-5 text-primary" />
                {t("nav.bookingPage")}
              </a>
            </div>
          </DialogContent>
        </Dialog>
      </div>
    </nav>
  );
}
