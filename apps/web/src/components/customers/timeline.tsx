import Link from "next/link";
import { CalendarCheck, CircleDollarSign, History, Megaphone, MessageCircle, PhoneCall, Send, ShieldOff, Star } from "lucide-react";
import type { TimelineItem } from "@fekerte/core/crm/timeline";
import { pickLocalized } from "@fekerte/core/lib/i18n";
import type { Locale } from "@fekerte/core/db/schema";
import type { TFn, TKey } from "@/i18n";
import { fmtDate, fmtDateTime, fmtPrice } from "@/lib/format";

const ICONS = {
  appointment: CalendarCheck,
  status: History,
  conversation: MessageCircle,
  call: PhoneCall,
  notification: Send,
  review: Star,
  payment: CircleDollarSign,
  consent: ShieldOff,
} as const;

function describe(item: TimelineItem, t: TFn, tz: string, locale: Locale): { title: string; detail?: string | null; href?: string } {
  switch (item.kind) {
    case "appointment":
      return {
        title: t("timeline.booked", { service: pickLocalized(item.service, locale), staff: item.staffName, date: fmtDate(item.startsAt.toISOString(), tz, locale, { weekday: "short", day: "numeric", month: "short", year: "numeric" }) }),
        detail: `${t("timeline.via", { source: t(`source.${item.source}` as TKey) })} · ${t(`status.${item.status}` as TKey)}${item.priceCents !== null ? ` · ${fmtPrice(item.priceCents)}` : ""}`,
      };
    case "status":
      return { title: t("timeline.statusChange", { action: item.action.replace(/^appointment\./, "").replace(/_/g, " ") }), detail: item.actorType };
    case "conversation":
      return {
        title: t("timeline.conversation", { channel: t(`source.${item.channel}` as TKey), n: item.messageCount }),
        detail: item.lastMessage?.slice(0, 140),
        href: `/dashboard/inbox/${item.id}`,
      };
    case "call":
      return { title: t("timeline.call", { outcome: item.outcome ? t(`calls.outcomes.${item.outcome}` as TKey) : "—" }), detail: item.summary, href: `/dashboard/calls/${item.id}` };
    case "notification":
      return { title: t("timeline.sent", { template: t(`timeline.templates.${item.template}` as TKey) }), detail: item.status === "skipped" || item.status === "failed" ? item.status : item.body.slice(0, 160) };
    case "review":
      return { title: item.rating ? t("timeline.review", { rating: item.rating }) : t(`timeline.templates.review_request`), detail: item.feedback ? `${t("timeline.feedback")}: ${item.feedback}` : null };
    case "payment":
      return { title: t("timeline.payment", { amount: fmtPrice(item.amountCents), status: item.status }), detail: [item.method, item.reference].filter(Boolean).join(" · ") };
    case "consent":
      return { title: t("timeline.consent", { action: item.action.replace(/^customer\./, "").replace(/_/g, " ") }) };
  }
}

export function CustomerTimeline({ items, t, tz, locale }: { items: TimelineItem[]; t: TFn; tz: string; locale: Locale }) {
  if (!items.length) return <p className="text-sm text-muted-foreground">{t("timeline.empty")}</p>;
  return (
    <ol className="relative grid gap-4 border-s ps-5" data-testid="customer-timeline">
      {items.map((item, i) => {
        const Icon = item.kind === "notification" && item.campaignId ? Megaphone : ICONS[item.kind];
        const d = describe(item, t, tz, locale);
        const negative = item.kind === "review" && (item.rating ?? 5) <= 3;
        return (
          <li key={`${item.kind}-${i}`} className="relative">
            <span className={`absolute -start-[31px] top-0.5 grid size-5 place-items-center rounded-full border bg-card ${negative ? "text-destructive" : "text-muted-foreground"}`}>
              <Icon className="size-3" />
            </span>
            <div className="flex flex-wrap items-baseline justify-between gap-x-3">
              {d.href ? (
                <Link href={d.href} className="text-sm font-medium hover:underline">
                  {d.title}
                </Link>
              ) : (
                <p className="text-sm font-medium">{d.title}</p>
              )}
              <time className="text-xs text-muted-foreground">{fmtDateTime(item.at.toISOString(), tz, locale)}</time>
            </div>
            {d.detail ? <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">{d.detail}</p> : null}
          </li>
        );
      })}
    </ol>
  );
}
