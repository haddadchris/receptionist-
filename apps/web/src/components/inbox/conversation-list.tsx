"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { Bot, Globe, MessageCircle, Phone, UserRound } from "lucide-react";
import { useI18n } from "@/i18n/client";
import { cn, initials } from "@/lib/utils";
import { fmtTime, fmtDate } from "@/lib/format";
import { Badge } from "@/components/ui/card";

export type InboxItem = {
  id: string;
  channel: "whatsapp" | "voice" | "web_chat";
  status: "ai_active" | "human_takeover" | "closed";
  name: string | null;
  phone: string | null;
  unread: number;
  lastAt: string | null;
  preview: string | null;
  previewSender: string | null;
};

const CHANNEL_ICON = { whatsapp: MessageCircle, voice: Phone, web_chat: Globe };

export function ConversationList({ items, tz }: { items: InboxItem[]; tz: string }) {
  const { t, locale } = useI18n();
  const pathname = usePathname();
  const params = useSearchParams();
  const filter = params.get("filter") ?? "all";
  const today = new Date().toDateString();
  const tabs = [
    { id: "all", label: t("inbox.all") },
    { id: "needs_attention", label: t("inbox.needsAttention") },
    { id: "human_takeover", label: t("inbox.human") },
    { id: "ai_active", label: t("inbox.aiActive") },
  ];
  return (
    <div className="flex h-full flex-col">
      <div className="scrollbar-none flex gap-1 overflow-x-auto border-b p-2">
        {tabs.map((tab) => (
          <Link
            key={tab.id}
            href={`/dashboard/inbox?filter=${tab.id}`}
            className={cn("rounded-full px-3 py-1 text-xs whitespace-nowrap", filter === tab.id ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-accent")}
          >
            {tab.label}
          </Link>
        ))}
      </div>
      {items.length === 0 ? <p className="p-6 text-center text-sm text-muted-foreground">{t("inbox.empty")}</p> : null}
      <ul className="flex-1 divide-y overflow-y-auto">
        {items.map((c) => {
          const Icon = CHANNEL_ICON[c.channel];
          const active = pathname === `/dashboard/inbox/${c.id}`;
          const at = c.lastAt ? (new Date(c.lastAt).toDateString() === today ? fmtTime(c.lastAt, tz, locale) : fmtDate(c.lastAt, tz, locale, { day: "numeric", month: "short" })) : "";
          return (
            <li key={c.id}>
              <Link href={`/dashboard/inbox/${c.id}?filter=${filter}`} className={cn("flex gap-3 p-3 hover:bg-accent/50", active && "bg-primary/5")}>
                <span className="relative grid size-10 shrink-0 place-items-center rounded-full bg-primary/10 text-xs font-semibold text-primary">
                  {initials(c.name ?? "#")}
                  <Icon className="absolute -end-0.5 -bottom-0.5 size-4 rounded-full bg-background p-0.5 text-success" />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className={cn("truncate text-sm", c.unread ? "font-semibold" : "font-medium")}>{c.name ?? c.phone ?? "Web visitor"}</span>
                    <span className="ms-auto shrink-0 text-[11px] text-muted-foreground">{at}</span>
                  </div>
                  <div className="mt-0.5 flex items-center gap-1.5">
                    {c.status === "human_takeover" ? (
                      <Badge tone="warning" className="px-1.5 py-0 text-[10px]">
                        <UserRound className="size-3" /> {t("inbox.humanBadge")}
                      </Badge>
                    ) : c.status === "ai_active" ? (
                      <Badge tone="default" className="px-1.5 py-0 text-[10px]">
                        <Bot className="size-3" /> {t("inbox.aiBadge")}
                      </Badge>
                    ) : null}
                    <span className="truncate text-xs text-muted-foreground">{c.preview ?? ""}</span>
                    {c.unread ? <span className="ms-auto rounded-full bg-primary px-1.5 text-[10px] font-semibold text-primary-foreground">{c.unread}</span> : null}
                  </div>
                </div>
              </Link>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
