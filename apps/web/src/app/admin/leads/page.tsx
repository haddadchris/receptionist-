import { withSuperAdmin } from "@fekerte/core/db/tenant";
import { LEAD_STAGES, listLeads } from "@fekerte/core/sales/leads";
import { getT } from "@/i18n/server";
import type { TKey } from "@/i18n";
import { PageHeader } from "@/components/ui/stat";
import { LeadCard } from "@/components/admin/lead-card";
import { fmtDateTime, intlLocale } from "@/lib/format";

export const metadata = { title: "Leads" };

/** Sales pipeline: lead → demo → trial → paying (or lost). */
export default async function LeadsPage() {
  const { t, locale } = await getT();
  const rows = await withSuperAdmin((tx) => listLeads(tx));
  const paying = rows.filter((r) => r.stage === "paying").length;
  const pct = rows.length ? new Intl.NumberFormat(intlLocale(locale), { style: "percent", maximumFractionDigits: 0 }).format(paying / rows.length) : "—";
  return (
    <div>
      <PageHeader title={t("leads.title")} description={`${t("leads.total", { n: rows.length })} · ${t("leads.conversion", { pct })}`} />
      <div className="-mx-4 flex snap-x gap-3 overflow-x-auto px-4 pb-4 lg:grid lg:grid-cols-6 lg:overflow-visible">
        {LEAD_STAGES.map((stage) => {
          const items = rows.filter((r) => r.stage === stage);
          return (
            <section key={stage} className="grid w-72 shrink-0 snap-start content-start gap-2 rounded-xl bg-muted/50 p-2 lg:w-auto" data-testid={`lead-column-${stage}`}>
              <h2 className="flex items-center justify-between px-1 text-sm font-semibold">
                {t(`leads.stages.${stage}` as TKey)} <span className="text-xs text-muted-foreground">{items.length}</span>
              </h2>
              {items.length === 0 ? <p className="px-1 py-3 text-xs text-muted-foreground">{t("leads.empty")}</p> : null}
              {items.map((l) => (
                <LeadCard
                  key={l.id}
                  created={fmtDateTime(l.createdAt.toISOString(), "Asia/Beirut", locale)}
                  lead={{
                    id: l.id,
                    name: l.name,
                    businessName: l.businessName,
                    phone: l.phone,
                    email: l.email,
                    vertical: l.vertical,
                    city: l.city,
                    message: l.message,
                    notes: l.notes,
                    stage: l.stage,
                    createdAt: l.createdAt.toISOString(),
                  }}
                />
              ))}
            </section>
          );
        })}
      </div>
    </div>
  );
}
