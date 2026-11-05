import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getBusinessBySlug, getPublicCatalog } from "@fekerte/core/business/public";
import { bookingSettings } from "@fekerte/core/availability/loader";
import { getT } from "@/i18n/server";
import { BookingFlow } from "@/components/booking/booking-flow";
import { BookingHeader, brandStyle } from "@/components/booking/booking-header";

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const b = await getBusinessBySlug(slug);
  return b ? { title: b.name, description: b.branding.tagline?.en ?? `Book online with ${b.name}` } : { title: "Not found" };
}

export default async function BookingPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const business = await getBusinessBySlug(slug);
  if (!business) notFound();
  const { t, locale } = await getT();
  if (!business.languages.includes(locale)) redirect(`/b/${business.slug}?lang=${business.defaultLanguage}`);
  const catalog = await getPublicCatalog(business.id);
  const settings = bookingSettings(business);
  const policies = settings.policies?.[locale] ?? settings.policies?.en;

  return (
    <div style={brandStyle(business.branding.primaryColor)} className="min-h-dvh bg-muted/40">
      <BookingHeader business={business} locale={locale} callLabel={t("booking.callUs")} directionsLabel={t("booking.directions")} />
      <main className="mx-auto -mt-3 max-w-xl px-4 pb-10">
        <div className="rounded-2xl border bg-background p-4 shadow-sm sm:p-6">
          <BookingFlow
            slug={business.slug}
            businessName={business.name}
            tz={business.timezone}
            allowAnyStaff={settings.allowAnyStaff}
            showLbp={business.showLbp}
            lbpRate={business.lbpRate}
            services={catalog.services.map((s) => ({
              id: s.id,
              name: s.name,
              description: s.description,
              durationMinutes: s.durationMinutes,
              priceCents: s.priceCents,
              priceFrom: s.priceFrom,
              staffIds: catalog.staff.filter((m) => m.serviceIds.includes(s.id)).map((m) => m.id),
            }))}
            staff={catalog.staff.map((m) => ({ id: m.id, name: m.name, title: m.title ?? {}, color: m.color }))}
          />
        </div>
        {policies ? <p className="mt-4 px-2 text-xs leading-relaxed text-muted-foreground">{policies}</p> : null}
        <p className="mt-6 text-center text-xs text-muted-foreground">
          <Link href="/" className="hover:underline">
            {t("common.poweredBy")}
          </Link>
        </p>
      </main>
    </div>
  );
}
