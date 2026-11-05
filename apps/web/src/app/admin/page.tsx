import Link from "next/link";
import { withSuperAdmin } from "@fekerte/core/db/tenant";
import { listBusinessesForAdmin, platformTotals } from "@fekerte/core/admin/overview";
import { getT } from "@/i18n/server";
import { Stat } from "@/components/ui/stat";
import { Badge } from "@/components/ui/card";
import { Input } from "@/components/ui/form";
import { Button } from "@/components/ui/button";
import { startImpersonationAction } from "./actions";
import { fmtDate } from "@/lib/format";

export const metadata = { title: "Admin" };

const STATUS_TONE = { trial: "warning", active: "success", paused: "muted", cancelled: "destructive" } as const;

export default async function AdminPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const { q } = await searchParams;
  const { t, locale } = await getT();
  const { rows, totals } = await withSuperAdmin(async (tx) => ({
    rows: await listBusinessesForAdmin(tx, { search: q?.slice(0, 60) }),
    totals: await platformTotals(tx),
  }));
  return (
    <div className="grid gap-5">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        <Stat label={t("admin.businesses")} value={totals.businesses} />
        <Stat label="Active" value={totals.active} />
        <Stat label="Trials" value={totals.trials} />
        <Stat label={t("admin.appointments30d")} value={totals.bookings30d} />
        <Stat label="Users" value={totals.users} />
      </div>
      <form className="flex max-w-md gap-2">
        <Input name="q" defaultValue={q} placeholder={t("common.search")} />
        <Button type="submit" variant="secondary">
          {t("common.search")}
        </Button>
      </form>
      <div className="overflow-x-auto rounded-xl border bg-card">
        <table className="w-full min-w-[860px] text-sm">
          <thead className="border-b bg-muted/50 text-xs text-muted-foreground">
            <tr className="text-start">
              <th className="p-3 text-start font-medium">{t("admin.businesses")}</th>
              <th className="p-3 text-start font-medium">{t("admin.tier")}</th>
              <th className="p-3 text-start font-medium">{t("admin.status")}</th>
              <th className="p-3 text-end font-medium">{t("admin.appointments30d")}</th>
              <th className="p-3 text-end font-medium">{t("admin.aiMessages")}</th>
              <th className="p-3 text-end font-medium">{t("admin.voiceMinutes")}</th>
              <th className="p-3 text-start font-medium">{t("admin.created")}</th>
              <th className="p-3" />
            </tr>
          </thead>
          <tbody className="divide-y">
            {rows.map((b) => (
              <tr key={b.id} className="hover:bg-muted/30">
                <td className="p-3">
                  <Link href={`/admin/businesses/${b.id}`} className="font-medium hover:underline">
                    {b.name}
                  </Link>
                  <div className="text-xs text-muted-foreground" dir="ltr">
                    /b/{b.slug} · {b.ownerEmail}
                  </div>
                </td>
                <td className="p-3">
                  <Badge tone="secondary" className="capitalize">
                    {b.planTier}
                  </Badge>
                </td>
                <td className="p-3">
                  <Badge tone={STATUS_TONE[b.status]} className="capitalize">
                    {b.status}
                  </Badge>
                </td>
                <td className="p-3 text-end tabular-nums">{b.bookings30d}</td>
                <td className="p-3 text-end tabular-nums">{Math.round(b.aiMessages)}</td>
                <td className="p-3 text-end tabular-nums">{Math.round(b.voiceMinutes)}</td>
                <td className="p-3 text-xs text-muted-foreground">{fmtDate(b.createdAt.toISOString(), "Asia/Beirut", locale, { day: "numeric", month: "short", year: "numeric" })}</td>
                <td className="p-3 text-end">
                  <form action={startImpersonationAction.bind(null, b.id)}>
                    <Button size="sm" variant="outline" type="submit">
                      {t("admin.impersonate")}
                    </Button>
                  </form>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
