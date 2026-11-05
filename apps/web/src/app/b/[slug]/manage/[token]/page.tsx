import { verifyManageToken } from "@fekerte/core/booking/tokens";
import { getAppointmentView } from "@fekerte/core/booking/service";
import { getBusinessBySlug } from "@fekerte/core/business/public";
import { bookingSettings } from "@fekerte/core/availability/loader";
import { withTenant } from "@fekerte/core/db/tenant";
import { pickLocalized } from "@fekerte/core/lib/i18n";
import { getT } from "@/i18n/server";
import { BookingHeader, brandStyle } from "@/components/booking/booking-header";
import { ManageAppointment } from "@/components/booking/manage-appointment";

export const metadata = { title: "Your appointment", robots: { index: false } };

export default async function ManagePage({ params }: { params: Promise<{ slug: string; token: string }> }) {
  const { slug, token } = await params;
  const { t, locale } = await getT();
  const business = await getBusinessBySlug(slug);
  const id = verifyManageToken(token);
  const appt = business && id && /^[0-9a-f-]{36}$/.test(id) ? await withTenant(business.id, (tx) => getAppointmentView(tx, business.id, id)) : null;

  if (!business || !appt) {
    return (
      <main className="mx-auto grid min-h-dvh max-w-md place-items-center p-6 text-center">
        <div>
          <p className="text-lg font-semibold">{t("manage.invalid")}</p>
          {business ? (
            <a className="mt-4 inline-block text-primary underline" href={`/b/${business.slug}`}>
              {t("manage.bookAgain")}
            </a>
          ) : null}
        </div>
      </main>
    );
  }
  const notice = bookingSettings(business).cancellationNoticeHours;
  // eslint-disable-next-line react-hooks/purity -- request-time check
  const canChange = appt.startsAt.getTime() - Date.now() >= notice * 3_600_000;

  return (
    <div style={brandStyle(business.branding.primaryColor)} className="min-h-dvh bg-muted/40">
      <BookingHeader business={business} locale={locale} callLabel={t("booking.callUs")} directionsLabel={t("booking.directions")} />
      <main className="mx-auto -mt-3 max-w-xl px-4 pb-10">
        <div className="rounded-2xl border bg-background p-4 shadow-sm sm:p-6">
          <h2 className="mb-4 text-lg font-semibold">{t("manage.title")}</h2>
          <ManageAppointment
            token={token}
            slug={business.slug}
            tz={business.timezone}
            canChange={canChange}
            appt={{
              serviceId: appt.serviceId,
              serviceName: pickLocalized(appt.serviceName, locale),
              staffName: appt.staffName,
              staffId: appt.staffId,
              startsAt: appt.startsAt.toISOString(),
              status: appt.status,
              depositStatus: appt.depositStatus,
              depositCents: appt.depositCents,
              depositDueAt: appt.depositDueAt?.toISOString() ?? null,
            }}
          />
        </div>
      </main>
    </div>
  );
}
