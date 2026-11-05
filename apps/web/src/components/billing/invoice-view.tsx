import type { Business, InvoiceLine } from "@fekerte/core/db/schema";
import { getT } from "@/i18n/server";
import type { TKey } from "@/i18n";
import { Badge } from "@/components/ui/card";
import { Logo } from "@/components/layout/logo";
import { fmtDate, fmtPrice } from "@/lib/format";

export type InvoiceData = {
  id: string;
  number: string;
  status: "draft" | "issued" | "paid" | "void";
  periodStart: Date | null;
  periodEnd: Date | null;
  lines: InvoiceLine[];
  totalCents: number;
  issuedAt: Date | null;
  dueAt: Date | null;
  paidAt: Date | null;
  paymentMethod: string | null;
  paymentReference: string | null;
  receiptUrl: string | null;
  notes: string | null;
};

const TONE = { draft: "muted", issued: "warning", paid: "success", void: "muted" } as const;

/** Printable invoice (browser "Print → Save as PDF" produces the PDF). */
export async function InvoiceView({ invoice, business, instructions }: { invoice: InvoiceData; business: Pick<Business, "name" | "address" | "city" | "phone" | "email" | "timezone">; instructions?: string | null }) {
  const { t, locale } = await getT();
  const d = (x: Date | null) => (x ? fmtDate(x.toISOString(), business.timezone, locale, { day: "numeric", month: "long", year: "numeric" }) : "—");
  return (
    <article className="mx-auto grid max-w-3xl gap-6 rounded-xl border bg-card p-5 print:border-0 print:p-0 sm:p-8" data-testid="invoice">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="grid gap-1">
          <Logo />
          <p className="text-xs text-muted-foreground">{process.env.BILLING_COMPANY_DETAILS ?? "Fekerte · Beirut, Lebanon · billing@fekerte.app"}</p>
        </div>
        <div className="grid gap-1 text-end">
          <p className="text-sm text-muted-foreground">{t("billing.invoice")}</p>
          <p className="text-xl font-semibold" dir="ltr">
            {invoice.number}
          </p>
          <Badge tone={TONE[invoice.status]} className="justify-self-end">
            {t(`billing.invoiceStatus.${invoice.status}` as TKey)}
          </Badge>
        </div>
      </header>
      <section className="grid gap-4 text-sm sm:grid-cols-2">
        <div>
          <p className="text-xs text-muted-foreground">{t("billing.billedTo")}</p>
          <p className="font-medium">{business.name}</p>
          {business.address || business.city ? <p>{[business.address, business.city].filter(Boolean).join(", ")}</p> : null}
          {business.phone ? <p dir="ltr" className="text-start rtl:text-end">{business.phone}</p> : null}
        </div>
        <div className="grid gap-1 sm:text-end">
          <p>
            <span className="text-muted-foreground">{t("billing.period")}: </span>
            {d(invoice.periodStart)} – {d(invoice.periodEnd)}
          </p>
          {invoice.status === "paid" ? (
            <p>{t("billing.paidOn", { date: d(invoice.paidAt) })}</p>
          ) : invoice.dueAt ? (
            <p>{t("billing.dueOn", { date: d(invoice.dueAt) })}</p>
          ) : null}
        </div>
      </section>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b text-xs text-muted-foreground">
              <th className="py-2 text-start font-medium">{t("billing.description")}</th>
              <th className="py-2 text-end font-medium">{t("billing.qty")}</th>
              <th className="py-2 text-end font-medium">{t("billing.unit")}</th>
              <th className="py-2 text-end font-medium">{t("billing.amount")}</th>
            </tr>
          </thead>
          <tbody>
            {invoice.lines.map((l, i) => (
              <tr key={i} className="border-b">
                <td className="py-2 pe-2">{l.description}</td>
                <td className="py-2 text-end tabular-nums">{l.quantity}</td>
                <td className="py-2 text-end tabular-nums">{fmtPrice(l.unitCents)}</td>
                <td className="py-2 text-end tabular-nums">{fmtPrice(l.totalCents)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td colSpan={3} className="py-3 text-end font-semibold">
                {t("billing.total")} (USD)
              </td>
              <td className="py-3 text-end text-lg font-semibold tabular-nums" data-testid="invoice-total">
                {fmtPrice(invoice.totalCents)}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>
      {invoice.status === "paid" ? (
        <p className="text-sm">
          {t("billing.paymentMethod")}: {invoice.paymentMethod ? t(`billing.methods.${invoice.paymentMethod}` as TKey) : "—"}
          {invoice.paymentReference ? ` · ${t("billing.reference")}: ${invoice.paymentReference}` : ""}
        </p>
      ) : invoice.status === "issued" && instructions ? (
        <section className="grid gap-1 rounded-lg bg-muted p-4 text-sm">
          <p className="font-medium">{t("billing.howToPay")}</p>
          <p className="whitespace-pre-line">{instructions}</p>
          <p>{t("billing.payReference", { ref: invoice.number })}</p>
        </section>
      ) : null}
      {invoice.notes ? <p className="text-sm text-muted-foreground">{invoice.notes}</p> : null}
    </article>
  );
}
