import Link from "next/link";
import { DateTime } from "luxon";
import { and, eq, gte, lt, sql } from "drizzle-orm";
import { CalendarDays, ExternalLink } from "lucide-react";
import { withTenant } from "@fekerte/core/db/tenant";
import { appointments } from "@fekerte/core/db/schema";
import { listAppointments } from "@fekerte/core/booking/service";
import { bookingUrl } from "@fekerte/core/booking/tokens";
import { requireBusiness } from "@/lib/auth/current";
import { getT } from "@/i18n/server";
import { toApptDTO } from "@/lib/dto";
import { Stat } from "@/components/ui/stat";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { CopyButton } from "@/components/copy-button";
import { AppointmentList } from "@/components/appointments/appointment-list";
import { fmtLocalDate } from "@/lib/format";

export const metadata = { title: "Overview" };

export default async function OverviewPage() {
  const ctx = await requireBusiness();
  const { t, locale } = await getT();
  const tz = ctx.business.timezone;
  const now = DateTime.now().setZone(tz);
  const dayStart = now.startOf("day").toJSDate();
  const dayEnd = now.endOf("day").toJSDate();
  const in7 = now.plus({ days: 7 }).endOf("day").toJSDate();
  const ago30 = now.minus({ days: 30 }).toJSDate();
  const bid = ctx.business.id;

  const data = await withTenant(bid, async (tx) => {
    const today = await listAppointments(tx, bid, { from: dayStart, to: dayEnd, statuses: ["pending", "confirmed", "completed", "no_show"] });
    const [counts] = await tx
      .select({
        next7: sql<number>`count(*) filter (where ${appointments.startsAt} >= now() and ${appointments.startsAt} < ${in7.toISOString()}::timestamptz and ${appointments.status} in ('pending','confirmed'))::int`,
        pending: sql<number>`count(*) filter (where ${appointments.status} = 'pending' and ${appointments.startsAt} >= now())::int`,
        done30: sql<number>`count(*) filter (where ${appointments.status} in ('completed','no_show') and ${appointments.startsAt} >= ${ago30.toISOString()}::timestamptz)::int`,
        noShow30: sql<number>`count(*) filter (where ${appointments.status} = 'no_show' and ${appointments.startsAt} >= ${ago30.toISOString()}::timestamptz)::int`,
      })
      .from(appointments)
      .where(and(eq(appointments.businessId, bid), gte(appointments.startsAt, ago30), lt(appointments.startsAt, in7)));
    return { today, counts: counts! };
  });

  const link = bookingUrl(ctx.business.slug);
  const upcomingToday = data.today.filter((a) => a.endsAt > new Date());
  const noShowRate = data.counts.done30 ? Math.round((data.counts.noShow30 / data.counts.done30) * 100) : 0;

  return (
    <div className="grid gap-5">
      <div>
        <h1 className="text-xl font-semibold">{t("overview.greeting", { name: (ctx.user.name ?? "").replace(/^(dr\.?|د\.)\s+/i, "").split(" ")[0] || ctx.business.name })}</h1>
        <p className="text-sm text-muted-foreground">
          {fmtLocalDate(now.toISODate()!, locale)}
          {ctx.business.status === "trial" && ctx.business.trialEndsAt
            ? ` · ${t("overview.trialEnds", { date: fmtLocalDate(DateTime.fromJSDate(ctx.business.trialEndsAt).setZone(tz).toISODate()!, locale, { day: "numeric", month: "long" }) })}`
            : ""}
        </p>
      </div>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label={t("overview.today")} value={data.today.length} />
        <Stat label={t("overview.upcoming7")} value={data.counts.next7} />
        <Stat label={t("overview.pendingApproval")} value={data.counts.pending} />
        <Stat label={t("overview.noShowRate")} value={`${noShowRate}%`} />
      </div>
      <div className="grid gap-5 lg:grid-cols-[1fr_340px]">
        <section className="grid gap-3">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold">{t("overview.nextUp")}</h2>
            <Button asChild variant="ghost" size="sm">
              <Link href="/dashboard/calendar">
                <CalendarDays /> {t("overview.viewCalendar")}
              </Link>
            </Button>
          </div>
          <AppointmentList
            appointments={upcomingToday.map((a) => toApptDTO(a, locale))}
            tz={tz}
            showDate={false}
            readOnly={ctx.readOnly}
            emptyText={t("overview.noAppointmentsToday")}
          />
        </section>
        <Card className="h-fit">
          <CardHeader>
            <CardTitle>{t("overview.bookingLink")}</CardTitle>
            <p className="text-xs text-muted-foreground">{t("overview.shareHint")}</p>
          </CardHeader>
          <CardContent className="grid gap-3">
            <code className="block rounded-md bg-muted p-2 text-xs break-all" dir="ltr">
              {link}
            </code>
            <div className="flex gap-2">
              <CopyButton value={link} />
              <Button asChild variant="outline" size="sm">
                <a href={link} target="_blank" rel="noreferrer">
                  <ExternalLink /> {t("common.open")}
                </a>
              </Button>
              <Button asChild variant="outline" size="sm">
                <a href={`https://wa.me/?text=${encodeURIComponent(link)}`} target="_blank" rel="noreferrer">
                  WhatsApp
                </a>
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
