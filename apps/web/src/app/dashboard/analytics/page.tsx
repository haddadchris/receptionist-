import Link from "next/link";
import { DateTime } from "luxon";
import { Bot, MessageSquareWarning, Star } from "lucide-react";
import { withTenant } from "@fekerte/core/db/tenant";
import { getAnalytics } from "@fekerte/core/growth/analytics";
import { listReviews } from "@fekerte/core/growth/reviews";
import { hasFeature } from "@fekerte/core/billing/features";
import { requireBusiness } from "@/lib/auth/current";
import { getT } from "@/i18n/server";
import type { TKey } from "@/i18n";
import { PageHeader, Stat } from "@/components/ui/stat";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { BarList, Heatmap, Legend, SegmentedBar, StackedColumns, TableView } from "@/components/analytics/charts";
import { fmtDate, fmtDateTime, fmtPrice, intlLocale } from "@/lib/format";
import { cn } from "@/lib/utils";

export const metadata = { title: "Analytics" };

const RANGES = [7, 30, 90] as const;

export default async function AnalyticsPage({ searchParams }: { searchParams: Promise<{ range?: string }> }) {
  const sp = await searchParams;
  const days = RANGES.includes(Number(sp.range) as never) ? (Number(sp.range) as (typeof RANGES)[number]) : 30;
  const ctx = await requireBusiness();
  const { t, locale, dict } = await getT();
  const b = ctx.business;
  const tz = b.timezone;
  const end = DateTime.now().setZone(tz).endOf("day");
  const start = end.minus({ days: days - 1 }).startOf("day");
  const { a, feedback } = await withTenant(b.id, async (tx) => ({
    a: await getAnalytics(tx, b.id, { from: start.toJSDate(), to: end.toJSDate(), timezone: tz }),
    feedback: await listReviews(tx, b.id, { onlyNegative: true, limit: 8 }),
  }));
  const pct = (v: number | null) => (v === null ? "—" : new Intl.NumberFormat(intlLocale(locale), { style: "percent", maximumFractionDigits: 0 }).format(v));
  const n = (v: number) => new Intl.NumberFormat(intlLocale(locale)).format(v);
  const hasVoice = hasFeature(b, "voiceAi");
  const hasAi = hasFeature(b, "whatsappAi") || hasFeature(b, "webChat");

  // Daily series with zero-filled days.
  const byDay = new Map(a.daily.map((d) => [d.day, d]));
  const series = [
    { key: "ai", label: t("analytics.aiShare"), color: "var(--viz-1)" },
    { key: "other", label: t("analytics.otherShare"), color: "var(--viz-2)" },
  ];
  const daily = Array.from({ length: days }, (_, i) => {
    const d = start.plus({ days: i });
    const iso = d.toISODate()!;
    const row = byDay.get(iso);
    const ai = row?.ai ?? 0;
    const other = (row?.count ?? 0) - ai;
    const label = fmtDate(d.toISO()!, tz, locale, { day: "numeric", month: "short" });
    return { label, iso, ai, other, tip: `${label}: ${n(ai + other)} (${t("analytics.aiShare")} ${n(ai)})` };
  });

  const sources = a.bookingsBySource.map((s) => {
    const label = t(`source.${s.source}` as TKey);
    return { label, value: s.count, display: n(s.count), tip: `${label}: ${n(s.count)} · ${fmtPrice(s.cents)}` };
  });

  const hoursWithData = a.busiest.map((c) => c.hour);
  const minH = Math.min(8, ...hoursWithData);
  const maxH = Math.max(19, ...hoursWithData);
  const hours = Array.from({ length: maxH - minH + 1 }, (_, i) => minH + i);
  // Dictionary weekdays are Monday-first (ISO 1–7).
  const weekdayNames = dict.weekdays.long;
  const weekdayShort = dict.weekdays.short;

  return (
    <div className="grid gap-5 [&>*]:min-w-0">
      <PageHeader
        title={t("analytics.title")}
        description={t("analytics.subtitle")}
        actions={
          <nav className="flex gap-1 rounded-lg border p-1 text-sm" aria-label="range">
            {RANGES.map((r) => (
              <Link key={r} href={`/dashboard/analytics?range=${r}`} className={cn("rounded-md px-3 py-1", r === days ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-accent")}>
                {t(`analytics.range${r}` as TKey)}
              </Link>
            ))}
          </nav>
        }
      />

      {/* Hero: the one number that proves ROI */}
      {hasAi || hasVoice ? (
        <Card className="bg-primary/5">
          <CardContent className="flex flex-wrap items-end justify-between gap-4 p-5 sm:p-6">
            <div>
              <p className="flex items-center gap-2 text-sm text-muted-foreground">
                <Bot className="size-4" /> {t("analytics.aiBookings")}
              </p>
              <p className="mt-1 text-5xl font-semibold" data-testid="hero-ai-bookings">
                {n(a.ai.bookings)}
              </p>
              <p className="mt-1 text-sm text-muted-foreground">
                {t("analytics.aiValue", { amount: fmtPrice(a.ai.cents) })} · {t("analytics.afterHours", { n: n(a.ai.afterHours) })}
              </p>
            </div>
          </CardContent>
        </Card>
      ) : null}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4 [&>*]:min-w-0">
        <Stat label={t("analytics.bookings")} value={n(a.totalBookings)} />
        <Stat label={t("analytics.revenue")} value={fmtPrice(a.revenue.completedCents)} hint={t("analytics.revenueHint", { amount: fmtPrice(a.revenue.bookedCents) })} />
        <Stat label={t("analytics.noShowRate")} value={pct(a.noShowRate)} hint={t("analytics.noShowHint", { n: n(a.outcomes.noShow) })} />
        {hasAi ? (
          <Stat label={t("analytics.conversion")} value={pct(a.conversations.conversion)} hint={<span dir="ltr">{`${n(a.conversations.converted)} / ${n(a.conversations.total)}`}</span>} />
        ) : (
          <Stat label={t("analytics.deposits")} value={fmtPrice(a.deposits.paidCents)} hint={t("analytics.depositsHint", { n: a.deposits.paid, amount: fmtPrice(a.deposits.paidCents), expired: a.deposits.expired })} />
        )}
      </div>

      <div className="grid gap-5 lg:grid-cols-[1.4fr_1fr] [&>*]:min-w-0">
        <Card>
          <CardHeader className="flex-row flex-wrap items-start justify-between gap-2">
            <CardTitle>{t("analytics.daily")}</CardTitle>
            <Legend series={series} />
          </CardHeader>
          <CardContent className="grid gap-3">
            <StackedColumns ariaLabel={t("analytics.daily")} series={series} data={daily.map((d) => ({ label: d.label, tip: d.tip, values: { ai: d.ai, other: d.other } }))} />
            <TableView summary={t("analytics.table")} head={["", t("analytics.aiShare"), t("analytics.otherShare")]} rows={daily.map((d) => [d.label, d.ai, d.other])} />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>{t("analytics.bySource")}</CardTitle>
          </CardHeader>
          <CardContent>{sources.length ? <BarList rows={sources} /> : <p className="text-sm text-muted-foreground">{t("analytics.none")}</p>}</CardContent>
        </Card>
      </div>

      <div className="grid gap-5 lg:grid-cols-[1.4fr_1fr] [&>*]:min-w-0">
        <Card>
          <CardHeader>
            <CardTitle>{t("analytics.busiest")}</CardTitle>
            <CardDescription>{t("analytics.busiestHint")}</CardDescription>
          </CardHeader>
          <CardContent>
            <Heatmap
              cells={a.busiest}
              rowLabels={[...weekdayShort]}
              hours={hours}
              tip={(d, h, c) => `${weekdayNames[d - 1] ?? d} ${String(h).padStart(2, "0")}:00 — ${n(c)}`}
              legend={{ low: "0", high: n(Math.max(0, ...a.busiest.map((c) => c.count))) }}
            />
          </CardContent>
        </Card>
        <div className="grid h-fit gap-5">
          {hasAi ? (
            <Card>
              <CardHeader>
                <CardTitle>{t("analytics.conversations")}</CardTitle>
                <CardDescription>
                  {t("analytics.aiHandled")}: {n(a.conversations.aiOnly)} · {t("analytics.humanHandled")}: {n(a.conversations.human)}
                </CardDescription>
              </CardHeader>
              <CardContent>
                <SegmentedBar
                  ariaLabel={t("analytics.conversations")}
                  parts={[
                    { label: t("analytics.aiHandled"), value: a.conversations.aiOnly, color: "var(--viz-1)", tip: `${t("analytics.aiHandled")}: ${n(a.conversations.aiOnly)}` },
                    { label: t("analytics.humanHandled"), value: a.conversations.human, color: "var(--viz-2)", tip: `${t("analytics.humanHandled")}: ${n(a.conversations.human)}` },
                  ]}
                />
              </CardContent>
            </Card>
          ) : null}
          {hasVoice ? (
            <Card>
              <CardHeader>
                <CardTitle>{t("analytics.calls")}</CardTitle>
                <CardDescription>{t("analytics.callBookings", { n: n(a.calls.booked) })}</CardDescription>
              </CardHeader>
              <CardContent className="grid grid-cols-2 gap-3">
                <Stat label={t("analytics.answered")} value={n(a.calls.answered)} />
                <Stat label={t("analytics.missed")} value={n(a.calls.missed)} />
              </CardContent>
            </Card>
          ) : null}
        </div>
      </div>

      <div className="grid gap-5 lg:grid-cols-3 [&>*]:min-w-0">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Star className="size-4" /> {t("analytics.reviews")}
            </CardTitle>
          </CardHeader>
          <CardContent className="grid gap-1">
            <p className="text-3xl font-semibold">{a.reviews.average ?? "—"}</p>
            <p className="text-xs text-muted-foreground">{t("analytics.reviewsCount", { n: a.reviews.count, positive: a.reviews.positive })}</p>
          </CardContent>
        </Card>
        <Stat label={t("analytics.recalls")} value={n(a.recalls.rebooked)} hint={t("analytics.recallsHint", { sent: a.recalls.sent, rebooked: a.recalls.rebooked })} />
        <Stat label={t("analytics.deposits")} value={fmtPrice(a.deposits.paidCents)} hint={t("analytics.depositsHint", { n: a.deposits.paid, amount: fmtPrice(a.deposits.paidCents), expired: a.deposits.expired })} />
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <MessageSquareWarning className="size-4" /> {t("analytics.privateFeedback")}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {feedback.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("analytics.noFeedback")}</p>
          ) : (
            <ul className="divide-y" data-testid="private-feedback">
              {feedback.map((f) => (
                <li key={f.review.id} className="grid gap-0.5 py-2.5">
                  <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
                    <Link href={`/dashboard/customers/${f.review.customerId}`} className="font-medium hover:underline">
                      {f.customerName ?? f.customerPhone}
                    </Link>
                    <span className="text-xs text-muted-foreground">
                      {f.review.rating}/5 · {f.review.respondedAt ? fmtDateTime(f.review.respondedAt.toISOString(), tz, locale) : ""}
                    </span>
                  </div>
                  <p className="text-sm text-muted-foreground">{f.review.feedback ?? "—"}</p>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
