import Link from "next/link";
import { and, eq, gte, sql } from "drizzle-orm";
import { DateTime } from "luxon";
import { withSuperAdmin } from "@fekerte/core/db/tenant";
import { listInvoices } from "@fekerte/core/billing/invoices";
import { businesses, invoices, subscriptions } from "@fekerte/core/db/schema";
import { getT } from "@/i18n/server";
import type { TKey } from "@/i18n";
import { Badge, Card, CardContent, EmptyState } from "@/components/ui/card";
import { PageHeader, Stat } from "@/components/ui/stat";
import { GenerateInvoicesButton, InvoiceAdminActions } from "@/components/admin/billing-admin";
import { fmtDate, fmtPrice } from "@/lib/format";
import { cn } from "@/lib/utils";

export const metadata = { title: "Invoices" };

const TONE = { draft: "muted", issued: "warning", paid: "success", void: "muted" } as const;
const FILTERS = ["all", "issued", "paid", "void"] as const;

export default async function AdminInvoicesPage({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  const { status } = await searchParams;
  const filter = FILTERS.includes(status as never) ? (status as (typeof FILTERS)[number]) : "all";
  const { t, locale } = await getT();
  const monthStart = DateTime.now().setZone("Asia/Beirut").startOf("month");
  const { rows, stats } = await withSuperAdmin(async (tx) => {
    const rows = await listInvoices(tx, { status: filter === "all" ? undefined : filter });
    const [outstanding] = await tx.select({ n: sql<number>`coalesce(sum(${invoices.totalCents}),0)::int` }).from(invoices).where(eq(invoices.status, "issued"));
    const [collected] = await tx
      .select({ n: sql<number>`coalesce(sum(${invoices.totalCents}),0)::int` })
      .from(invoices)
      .where(and(eq(invoices.status, "paid"), gte(invoices.paidAt, monthStart.toJSDate())));
    const [mrr] = await tx
      .select({ n: sql<number>`coalesce(sum(${subscriptions.monthlyFeeCents}),0)::int` })
      .from(subscriptions)
      .innerJoin(businesses, eq(businesses.id, subscriptions.businessId))
      .where(eq(businesses.status, "active"));
    return { rows, stats: { outstanding: outstanding?.n ?? 0, collected: collected?.n ?? 0, mrr: mrr?.n ?? 0 } };
  });
  return (
    <div className="grid gap-4">
      <PageHeader title={t("adminBilling.invoicesTitle")} actions={<GenerateInvoicesButton period={monthStart.toFormat("yyyy-MM")} />} />
      <div className="grid grid-cols-3 gap-3">
        <Stat label={t("adminBilling.mrr")} value={fmtPrice(stats.mrr)} />
        <Stat label={t("adminBilling.outstanding")} value={fmtPrice(stats.outstanding)} />
        <Stat label={t("adminBilling.collected")} value={fmtPrice(stats.collected)} />
      </div>
      <div className="flex gap-2 text-sm">
        {FILTERS.map((f) => (
          <Link
            key={f}
            href={f === "all" ? "/admin/invoices" : `/admin/invoices?status=${f}`}
            className={cn("rounded-full border px-3 py-1", filter === f ? "border-primary bg-primary/10 text-primary" : "text-muted-foreground")}
          >
            {f === "all" ? t("adminBilling.all") : t(`billing.invoiceStatus.${f}` as TKey)}
          </Link>
        ))}
      </div>
      <Card>
        <CardContent className="p-0 sm:p-0">
          {rows.length === 0 ? (
            <div className="p-4">
              <EmptyState title={t("billing.noInvoices")} />
            </div>
          ) : (
            <ul className="divide-y">
              {rows.map(({ invoice: inv, businessName }) => (
                <li key={inv.id} className="flex flex-wrap items-center justify-between gap-3 p-4" data-testid="admin-invoice-row">
                  <div className="min-w-0">
                    <Link href={`/admin/invoices/${inv.id}`} className="font-medium hover:underline" dir="ltr">
                      {inv.number}
                    </Link>
                    <p className="text-sm">{businessName}</p>
                    <p className="text-xs text-muted-foreground">
                      {inv.issuedAt ? fmtDate(inv.issuedAt.toISOString(), "Asia/Beirut", locale, { day: "numeric", month: "short", year: "numeric" }) : "—"}
                      {inv.paymentReference ? ` · ${inv.paymentReference}` : ""}
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-3">
                    <span className="font-semibold tabular-nums">{fmtPrice(inv.totalCents)}</span>
                    <Badge tone={TONE[inv.status]}>{t(`billing.invoiceStatus.${inv.status}` as TKey)}</Badge>
                    <InvoiceAdminActions invoiceId={inv.id} status={inv.status} />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
