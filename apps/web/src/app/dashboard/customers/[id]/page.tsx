import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, MessageCircle, Phone } from "lucide-react";
import { withTenant } from "@fekerte/core/db/tenant";
import { customerConversations, getCustomer } from "@fekerte/core/crm/customers";
import { listAppointments } from "@fekerte/core/booking/service";
import { isDomainError } from "@fekerte/core/lib/errors";
import { requireBusiness } from "@/lib/auth/current";
import { getT } from "@/i18n/server";
import { toApptDTO } from "@/lib/dto";
import { Stat } from "@/components/ui/stat";
import { Card, CardContent, CardHeader, CardTitle, Badge } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { AppointmentList } from "@/components/appointments/appointment-list";
import { CustomerEditor } from "@/components/customers/customer-editor";
import { fmtDate, fmtDateTime } from "@/lib/format";

export default async function CustomerPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const ctx = await requireBusiness();
  const { t, locale } = await getT();
  const tz = ctx.business.timezone;
  const data = await withTenant(ctx.business.id, async (tx) => {
    try {
      const customer = await getCustomer(tx, ctx.business.id, id);
      const [appts, convos] = await Promise.all([
        listAppointments(tx, ctx.business.id, { customerId: id, order: "desc", limit: 100 }),
        customerConversations(tx, ctx.business.id, id),
      ]);
      return { customer, appts, convos };
    } catch (e) {
      if (isDomainError(e) && e.code === "NOT_FOUND") return null;
      throw e;
    }
  });
  if (!data) notFound();
  const { customer, appts, convos } = data;

  return (
    <div className="grid gap-5">
      <div className="flex flex-wrap items-center gap-3">
        <Button asChild variant="ghost" size="icon-sm">
          <Link href="/dashboard/customers" aria-label={t("common.back")}>
            <ArrowLeft className="rtl:rotate-180" />
          </Link>
        </Button>
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-xl font-semibold">{customer.name ?? customer.phone}</h1>
          <p className="ltr-nums text-sm text-muted-foreground">{customer.phone}</p>
        </div>
        <Button asChild variant="outline" size="sm">
          <a href={`https://wa.me/${customer.phone.replace("+", "")}`} target="_blank" rel="noreferrer">
            <MessageCircle /> WhatsApp
          </a>
        </Button>
        <Button asChild variant="outline" size="sm">
          <a href={`tel:${customer.phone}`}>
            <Phone />
          </a>
        </Button>
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label={t("customers.visits")} value={customer.visits} />
        <Stat label={t("customers.upcoming")} value={customer.upcoming} />
        <Stat label={t("customers.noShows")} value={customer.noShowCount} />
        <Stat
          label={t("customers.since")}
          value={<span className="text-base">{fmtDate(customer.createdAt.toISOString(), tz, locale, { month: "short", year: "numeric" })}</span>}
        />
      </div>
      <div className="grid gap-5 lg:grid-cols-[1fr_380px]">
        <section className="grid gap-3">
          <h2 className="font-semibold">{t("customers.history")}</h2>
          <AppointmentList appointments={appts.map((a) => toApptDTO(a, locale))} tz={tz} readOnly={ctx.readOnly} />
          {convos.length ? (
            <>
              <h2 className="mt-2 font-semibold">{t("customers.conversations")}</h2>
              <ul className="divide-y rounded-xl border bg-card">
                {convos.map((c) => (
                  <li key={c.id} className="flex items-center justify-between gap-2 p-3 text-sm">
                    <span className="flex items-center gap-2">
                      <Badge tone="outline">{t(`source.${c.channel}`)}</Badge>
                      {c.summary ?? ""}
                    </span>
                    <span className="text-xs text-muted-foreground">{c.lastMessageAt ? fmtDateTime(c.lastMessageAt.toISOString(), tz, locale) : ""}</span>
                  </li>
                ))}
              </ul>
            </>
          ) : null}
        </section>
        <Card className="h-fit">
          <CardHeader>
            <CardTitle>{t("common.details")}</CardTitle>
          </CardHeader>
          <CardContent>
            <CustomerEditor
              readOnly={ctx.readOnly}
              customer={{
                id: customer.id,
                name: customer.name,
                notes: customer.notes,
                tags: customer.tags,
                preferredLanguage: customer.preferredLanguage,
                consentWhatsapp: customer.consentWhatsapp,
                consentMarketing: customer.consentMarketing,
              }}
            />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
