import { withTenant } from "@fekerte/core/db/tenant";
import { getStaffServiceLinks, listServices, listStaff } from "@fekerte/core/business/setup";
import { requireBusiness } from "@/lib/auth/current";
import { getT } from "@/i18n/server";
import { PageHeader } from "@/components/ui/stat";
import { ServicesManager } from "@/components/settings/services-manager";

export const metadata = { title: "Services" };

export default async function ServicesPage() {
  const ctx = await requireBusiness();
  const { t } = await getT();
  const bid = ctx.business.id;
  const { services, staff, links } = await withTenant(bid, async (tx) => ({
    services: await listServices(tx, bid),
    staff: await listStaff(tx, bid, { activeOnly: true }),
    links: await getStaffServiceLinks(tx, bid),
  }));
  return (
    <div>
      <PageHeader title={t("services.title")} />
      <ServicesManager
        readOnly={ctx.readOnly || ctx.role === "staff"}
        staff={staff.map((s) => ({ id: s.id, name: s.name }))}
        services={services.map((s) => ({
          id: s.id,
          name: s.name,
          description: s.description,
          category: s.category,
          durationMinutes: s.durationMinutes,
          bufferBeforeMinutes: s.bufferBeforeMinutes,
          bufferAfterMinutes: s.bufferAfterMinutes,
          priceCents: s.priceCents,
          priceFrom: s.priceFrom,
          depositRequired: s.depositRequired,
          depositCents: s.depositCents,
          recallIntervalDays: s.recallIntervalDays,
          bookableOnline: s.bookableOnline,
          active: s.active,
          staffIds: links.filter((l) => l.serviceId === s.id).map((l) => l.staffId),
        }))}
      />
    </div>
  );
}
