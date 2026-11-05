import Link from "next/link";
import { Mic, Phone, PhoneIncoming } from "lucide-react";
import { withTenant } from "@fekerte/core/db/tenant";
import { listCalls } from "@fekerte/core/voice/calls";
import { requireBusiness } from "@/lib/auth/current";
import { getT } from "@/i18n/server";
import type { TKey } from "@/i18n";
import { PageHeader } from "@/components/ui/stat";
import { Badge, EmptyState } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { fmtDateTime } from "@/lib/format";
import { fmtDuration, OUTCOME_TONE } from "@/lib/calls";

export const metadata = { title: "Calls" };

export default async function CallsPage() {
  const ctx = await requireBusiness();
  const { t, locale } = await getT();
  const rows = await withTenant(ctx.business.id, (tx) => listCalls(tx, ctx.business.id, { limit: 200 }));
  return (
    <div>
      <PageHeader
        title={t("calls.title")}
        actions={
          <Button asChild>
            <Link href="/dashboard/voice/test">
              <Mic /> {t("calls.simulator")}
            </Link>
          </Button>
        }
      />
      {rows.length === 0 ? (
        <EmptyState icon={<Phone className="size-8" />} title={t("calls.empty")} />
      ) : (
        <ul className="divide-y rounded-xl border bg-card">
          {rows.map(({ call, customerName }) => (
            <li key={call.id}>
              <Link href={`/dashboard/calls/${call.id}`} className="flex items-center gap-3 p-3 hover:bg-accent/50">
                <span className="grid size-9 shrink-0 place-items-center rounded-full bg-primary/10 text-primary">
                  {call.provider === "browser" ? <Mic className="size-4" /> : <PhoneIncoming className="size-4" />}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate font-medium">{customerName ?? (call.fromNumber ? <span className="ltr-nums">{call.fromNumber}</span> : t("calls.unknownCaller"))}</span>
                    {call.provider === "browser" ? <Badge tone="outline">{t("calls.browser")}</Badge> : null}
                  </div>
                  <div className="truncate text-xs text-muted-foreground">{call.summary ?? "…"}</div>
                </div>
                <div className="shrink-0 text-end text-xs">
                  {call.outcome ? <Badge tone={OUTCOME_TONE[call.outcome]}>{t(`calls.outcomes.${call.outcome}` as TKey)}</Badge> : null}
                  <div className="mt-1 text-muted-foreground">
                    {fmtDateTime(call.startedAt.toISOString(), ctx.business.timezone, locale)} · <span className="ltr-nums">{fmtDuration(call.durationSeconds)}</span>
                  </div>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
