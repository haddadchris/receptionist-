import { eq } from "drizzle-orm";
import { CheckCircle2, CreditCard } from "lucide-react";
import { withSystem, withTenant } from "@fekerte/core/db/tenant";
import { appointments, businesses, payments } from "@fekerte/core/db/schema";
import { verifyValue } from "@fekerte/core/booking/tokens";
import { DEPOSIT_TOKEN_PURPOSE } from "@fekerte/core/booking/deposit-rules";
import { markDepositPaid } from "@fekerte/core/growth/deposits";
import { config } from "@fekerte/core/config";
import { getT } from "@/i18n/server";
import { Button } from "@/components/ui/button";
import { fmtPrice } from "@/lib/format";
import { revalidatePath } from "next/cache";

export const metadata = { title: "Pay deposit", robots: { index: false } };
export const dynamic = "force-dynamic";

/** Demo-only payment page for PAYMENTS_PROVIDER=mock_link. Never charges anyone; disabled in production. */
const mockEnabled = () => process.env.PAYMENTS_PROVIDER === "mock_link" && (!config.isProduction || process.env.ALLOW_MOCK_PAYMENTS === "true");

async function load(token: string) {
  const paymentId = verifyValue(decodeURIComponent(token), DEPOSIT_TOKEN_PURPOSE);
  if (!paymentId || !/^[0-9a-f-]{36}$/.test(paymentId)) return null;
  return withSystem(async (tx) => {
    const [pay] = await tx.select().from(payments).where(eq(payments.id, paymentId));
    if (!pay || pay.kind !== "deposit" || !pay.appointmentId) return null;
    const [appt] = await tx.select().from(appointments).where(eq(appointments.id, pay.appointmentId));
    const [biz] = await tx.select().from(businesses).where(eq(businesses.id, pay.businessId));
    return appt && biz ? { pay, appt, biz } : null;
  });
}

export default async function MockPayPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const { t } = await getT();
  const data = mockEnabled() ? await load(token) : null;

  async function pay() {
    "use server";
    if (!mockEnabled()) return;
    const d = await load(token);
    if (!d || d.pay.status !== "pending" || d.appt.depositStatus !== "required") return;
    await withTenant(d.biz.id, (tx) =>
      markDepositPaid(tx, d.biz.id, d.appt.id, { method: "payment_link", reference: d.pay.providerRef, actor: { type: "customer", label: "mock payment link" } }),
    );
    revalidatePath(`/pay/mock/${token}`);
  }

  return (
    <main className="mx-auto grid min-h-dvh max-w-md place-items-center p-4">
      <div className="grid w-full gap-4 rounded-2xl border bg-card p-6 text-center shadow-sm">
        <CreditCard className="mx-auto size-8 text-primary" />
        <h1 className="text-xl font-semibold">{t("pay.title")}</h1>
        {!mockEnabled() ? (
          <p className="text-sm text-muted-foreground">{t("pay.notAvailable")}</p>
        ) : !data ? (
          <p className="text-sm text-muted-foreground">{t("pay.invalid")}</p>
        ) : data.appt.depositStatus === "paid" ? (
          <p className="flex items-center justify-center gap-2 text-success" data-testid="pay-done">
            <CheckCircle2 className="size-5" /> {t("pay.done")}
          </p>
        ) : data.appt.status === "cancelled" || data.pay.status !== "pending" ? (
          <p className="text-sm text-muted-foreground">{t("pay.invalid")}</p>
        ) : (
          <>
            <p className="text-sm text-muted-foreground">{data.biz.name}</p>
            <p className="text-3xl font-semibold">{fmtPrice(data.pay.amountCents)}</p>
            <p className="rounded-lg bg-warning/15 p-2 text-xs">{t("pay.demo")}</p>
            <form action={pay}>
              <Button type="submit" className="w-full">
                {t("pay.payNow")}
              </Button>
            </form>
          </>
        )}
      </div>
    </main>
  );
}
