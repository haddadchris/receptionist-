import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, CalendarCheck, Wrench } from "lucide-react";
import { withTenant } from "@fekerte/core/db/tenant";
import { getCallDetail } from "@fekerte/core/voice/calls";
import { isDomainError } from "@fekerte/core/lib/errors";
import { pickLocalized } from "@fekerte/core/lib/i18n";
import { requireBusiness } from "@/lib/auth/current";
import { getT } from "@/i18n/server";
import type { TKey } from "@/i18n";
import { Badge, Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Stat } from "@/components/ui/stat";
import { fmtDateTime, fmtTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import { fmtDuration, OUTCOME_TONE } from "@/lib/calls";

export default async function CallDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const ctx = await requireBusiness();
  const { t, locale } = await getT();
  const tz = ctx.business.timezone;
  const data = await withTenant(ctx.business.id, async (tx) => {
    try {
      return await getCallDetail(tx, ctx.business.id, id);
    } catch (e) {
      if (isDomainError(e) && e.code === "NOT_FOUND") return null;
      throw e;
    }
  });
  if (!data) notFound();
  const { call } = data;
  return (
    <div className="grid gap-5">
      <div className="flex flex-wrap items-center gap-3">
        <Button asChild variant="ghost" size="icon-sm">
          <Link href="/dashboard/calls" aria-label={t("common.back")}>
            <ArrowLeft className="rtl:rotate-180" />
          </Link>
        </Button>
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-xl font-semibold">{data.customerName ?? call.fromNumber ?? t("calls.unknownCaller")}</h1>
          <p className="text-sm text-muted-foreground">
            {fmtDateTime(call.startedAt.toISOString(), tz, locale)} · {call.provider === "browser" ? t("calls.browser") : t("calls.phone")} · {call.pipeline}
          </p>
        </div>
        {call.outcome ? <Badge tone={OUTCOME_TONE[call.outcome]}>{t(`calls.outcomes.${call.outcome}` as TKey)}</Badge> : null}
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <Stat label={t("calls.duration")} value={<span className="ltr-nums">{fmtDuration(call.durationSeconds)}</span>} />
        <Stat label={t("calls.from")} value={<span className="ltr-nums text-base">{call.fromNumber ?? "—"}</span>} />
        <Stat label={t("calls.outcome")} value={<span className="text-base">{call.outcome ? t(`calls.outcomes.${call.outcome}` as TKey) : "…"}</span>} />
      </div>
      <div className="grid gap-5 lg:grid-cols-[1fr_360px]">
        <Card>
          <CardHeader>
            <CardTitle>{t("calls.transcript")}</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-2">
            {call.transcript.map((turn, i) => (
              <div key={i} className={cn("flex", turn.role === "agent" ? "justify-end" : "justify-start")}>
                <div className={cn("max-w-[85%] rounded-2xl px-3 py-2 text-sm", turn.role === "agent" ? "rounded-se-sm bg-primary/10" : "rounded-ss-sm bg-muted")}>
                  <div className="text-[10px] font-medium text-muted-foreground">
                    {turn.role === "agent" ? `🤖 ${t("calls.agent")}` : t("calls.caller")} · {fmtTime(turn.at, tz, locale)}
                  </div>
                  <p dir="auto">{turn.text}</p>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
        <div className="grid h-fit gap-5">
          <Card>
            <CardHeader>
              <CardTitle>{t("calls.summary")}</CardTitle>
            </CardHeader>
            <CardContent className="text-sm">{call.summary ?? "…"}</CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>{t("calls.recording")}</CardTitle>
            </CardHeader>
            <CardContent>
              {call.recordingUrl ? (
                <audio controls preload="none" className="w-full" src={`/api/calls/${call.id}/recording`} />
              ) : (
                <p className="text-sm text-muted-foreground">{t("calls.noRecording")}</p>
              )}
            </CardContent>
          </Card>
          {data.appointment ? (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <CalendarCheck className="size-4 text-success" /> {t("calls.appointment")}
                </CardTitle>
              </CardHeader>
              <CardContent className="text-sm">
                <p className="font-medium">{pickLocalized(data.appointment.serviceName, locale)}</p>
                <p className="text-muted-foreground">
                  {fmtDateTime(data.appointment.startsAt.toISOString(), tz, locale)} · {data.appointment.staffName}
                </p>
                <Link className="mt-2 inline-block text-primary hover:underline" href={`/dashboard/customers/${data.appointment.customerId}`}>
                  {data.appointment.customerName ?? data.appointment.customerPhone}
                </Link>
              </CardContent>
            </Card>
          ) : null}
          {data.toolCalls.length ? (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Wrench className="size-4" /> {t("inbox.aiActions")}
                </CardTitle>
              </CardHeader>
              <CardContent className="grid gap-1">
                {data.toolCalls.map((c, i) => (
                  <pre key={i} className="overflow-x-auto rounded bg-muted p-2 text-[10px]" dir="ltr">
                    {c.name}({JSON.stringify(c.input)}) → {c.error ? `ERROR ${c.error}` : JSON.stringify(c.output)?.slice(0, 300)}
                  </pre>
                ))}
              </CardContent>
            </Card>
          ) : null}
        </div>
      </div>
    </div>
  );
}
