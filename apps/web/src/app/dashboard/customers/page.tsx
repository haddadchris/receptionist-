import Link from "next/link";
import { withTenant } from "@fekerte/core/db/tenant";
import { allTags, listCustomers } from "@fekerte/core/crm/customers";
import { requireBusiness } from "@/lib/auth/current";
import { getT } from "@/i18n/server";
import { PageHeader } from "@/components/ui/stat";
import { Input, Select } from "@/components/ui/form";
import { Button } from "@/components/ui/button";
import { Badge, EmptyState } from "@/components/ui/card";
import { fmtDate } from "@/lib/format";
import { initials } from "@/lib/utils";

export const metadata = { title: "Customers" };

export default async function CustomersPage({ searchParams }: { searchParams: Promise<{ q?: string; tag?: string; segment?: string }> }) {
  const sp = await searchParams;
  const ctx = await requireBusiness();
  const { t, locale } = await getT();
  const segment = sp.segment;
  const { rows, tags } = await withTenant(ctx.business.id, async (tx) => ({
    rows: await listCustomers(tx, ctx.business.id, {
      search: sp.q?.slice(0, 60),
      tags: sp.tag ? [sp.tag] : undefined,
      noVisitDays: segment === "lapsed" ? 180 : undefined,
      minNoShows: segment === "no_shows" ? 1 : undefined,
      hasUpcoming: segment === "upcoming" ? true : undefined,
      limit: 200,
    }),
    tags: await allTags(tx, ctx.business.id),
  }));
  const tz = ctx.business.timezone;

  return (
    <div>
      <PageHeader title={t("customers.title")} />
      <form className="mb-4 grid gap-2 sm:grid-cols-[1fr_auto_auto_auto]">
        <Input name="q" defaultValue={sp.q} placeholder={t("customers.searchPlaceholder")} />
        <Select name="segment" defaultValue={segment ?? ""}>
          <option value="">{t("common.all")}</option>
          <option value="upcoming">{t("customers.upcoming")}</option>
          <option value="lapsed">{t("customers.lastVisit")} &gt; 6m</option>
          <option value="no_shows">{t("customers.noShows")}</option>
        </Select>
        <Select name="tag" defaultValue={sp.tag ?? ""}>
          <option value="">{t("customers.tags")}</option>
          {tags.map((tag) => (
            <option key={tag} value={tag}>
              {tag}
            </option>
          ))}
        </Select>
        <Button type="submit" variant="secondary">
          {t("common.search")}
        </Button>
      </form>
      {rows.length === 0 ? (
        <EmptyState title={t("customers.empty")} />
      ) : (
        <ul className="divide-y rounded-xl border bg-card">
          {rows.map((c) => (
            <li key={c.id}>
              <Link href={`/dashboard/customers/${c.id}`} className="flex items-center gap-3 p-3 hover:bg-accent/50">
                <span className="grid size-9 shrink-0 place-items-center rounded-full bg-primary/10 text-xs font-semibold text-primary">{initials(c.name ?? "#")}</span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate font-medium">{c.name ?? "—"}</span>
                    {c.tags.slice(0, 3).map((tag) => (
                      <Badge key={tag} tone="secondary">
                        {tag}
                      </Badge>
                    ))}
                  </div>
                  <div className="ltr-nums text-xs text-muted-foreground">{c.phone}</div>
                </div>
                <div className="hidden text-end text-xs text-muted-foreground sm:block">
                  <div>
                    {t("customers.visits")}: <span className="font-medium text-foreground">{c.visits}</span>
                    {c.noShowCount ? (
                      <span className="ms-2 text-destructive">
                        {t("customers.noShows")}: {c.noShowCount}
                      </span>
                    ) : null}
                  </div>
                  {c.lastAppointmentAt ? (
                    <div>
                      {t("customers.lastVisit")}: {fmtDate(c.lastAppointmentAt.toISOString(), tz, locale, { day: "numeric", month: "short", year: "numeric" })}
                    </div>
                  ) : null}
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
