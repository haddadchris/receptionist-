import Link from "next/link";
import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import { ArrowLeft, Paperclip } from "lucide-react";
import { withSuperAdmin } from "@fekerte/core/db/tenant";
import { businesses, invoices } from "@fekerte/core/db/schema";
import { paymentInstructions } from "@fekerte/core/providers/payments";
import { getT } from "@/i18n/server";
import { Button } from "@/components/ui/button";
import { InvoiceView } from "@/components/billing/invoice-view";
import { PrintButton } from "@/components/billing/print-button";
import { InvoiceAdminActions } from "@/components/admin/billing-admin";

export const metadata = { title: "Invoice" };

export default async function AdminInvoicePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const { t } = await getT();
  const data = await withSuperAdmin(async (tx) => {
    const [inv] = await tx.select().from(invoices).where(eq(invoices.id, id));
    if (!inv) return null;
    const [b] = await tx.select().from(businesses).where(eq(businesses.id, inv.businessId));
    return { inv, b: b! };
  });
  if (!data) notFound();
  const { inv, b } = data;
  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2 print:hidden">
        <Button asChild variant="ghost" size="sm">
          <Link href="/admin/invoices">
            <ArrowLeft className="rtl:rotate-180" /> {t("adminBilling.invoicesTitle")}
          </Link>
        </Button>
        <div className="flex flex-wrap items-center gap-2">
          <Button asChild variant="ghost" size="sm">
            <Link href={`/admin/businesses/${b.id}`}>{b.name}</Link>
          </Button>
          {inv.receiptUrl ? (
            <Button asChild variant="outline" size="sm">
              <a href={`/api/admin/receipts/${inv.id}`} target="_blank" rel="noreferrer">
                <Paperclip /> {t("adminBilling.viewReceipt")}
              </a>
            </Button>
          ) : null}
          <InvoiceAdminActions invoiceId={inv.id} status={inv.status} />
          <PrintButton label={t("billing.print")} />
        </div>
      </div>
      <InvoiceView invoice={inv} business={b} instructions={paymentInstructions()} />
    </div>
  );
}
