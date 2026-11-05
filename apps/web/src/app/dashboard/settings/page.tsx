import { config } from "@fekerte/core/config";
import { bookingSettings } from "@fekerte/core/availability/loader";
import { requireBusiness } from "@/lib/auth/current";
import { getT } from "@/i18n/server";
import { PageHeader } from "@/components/ui/stat";
import { SettingsForm } from "@/components/settings/settings-form";

export const metadata = { title: "Settings" };

export default async function SettingsPage() {
  const ctx = await requireBusiness();
  const { t } = await getT();
  const b = ctx.business;
  return (
    <div>
      <PageHeader title={t("settings.title")} />
      <SettingsForm
        appUrl={config.appUrl}
        readOnly={ctx.readOnly || ctx.role === "staff"}
        initial={{
          name: b.name,
          slug: b.slug,
          vertical: b.vertical,
          phone: b.phone,
          email: b.email,
          address: b.address,
          city: b.city,
          mapsUrl: b.mapsUrl,
          googleReviewUrl: b.googleReviewUrl,
          whatsappNumber: b.whatsappNumber,
          languages: b.languages,
          defaultLanguage: b.defaultLanguage,
          timezone: b.timezone,
          showLbp: b.showLbp,
          lbpRate: b.lbpRate,
          branding: b.branding,
          bookingSettings: bookingSettings(b),
        }}
      />
    </div>
  );
}
