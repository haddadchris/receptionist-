import Link from "next/link";
import { notFound } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { ArrowLeft } from "lucide-react";
import { withTenant } from "@fekerte/core/db/tenant";
import { invoices } from "@fekerte/core/db/schema";
import { paymentInstructions } from "@fekerte/core/providers/payments";
import { requireBusiness } from "@/lib/auth/current";
import { getT } from "@/i18n/server";
import { Button } from "@/components/ui/button";
import { InvoiceView } from "@/components/billing/invoice-view";
import { PrintButton } from "@/components/billing/print-button";

export const metadata = { title: "Invoice" };

export default async function OwnerInvoicePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const ctx = await requireBusiness();
  if (ctx.role === "staff") notFound();
  const { t } = await getT();
  // RLS + explicit business filter: owners only ever see their own invoices.
  const [inv] = await withTenant(ctx.business.id, (tx) => tx.select().from(invoices).where(and(eq(invoices.id, id), eq(invoices.businessId, ctx.business.id))));
  if (!inv || inv.status === "draft") notFound();
  return (
    <div className="grid gap-4">
      <div className="flex items-center justify-between gap-2 print:hidden">
        <Button asChild variant="ghost" size="sm">
          <Link href="/dashboard/billing">
            <ArrowLeft className="rtl:rotate-180" /> {t("billing.title")}
          </Link>
        </Button>
        <PrintButton label={t("billing.print")} />
      </div>
      <InvoiceView invoice={inv} business={ctx.business} instructions={paymentInstructions()} />
    </div>
  );
}
