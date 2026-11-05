import { and, eq, gte } from "drizzle-orm";
import { withTenant } from "@fekerte/core/db/tenant";
import { getStaffServiceLinks, getWeeklyHours, listServices, listStaff } from "@fekerte/core/business/setup";
import { timeOff, workingHours } from "@fekerte/core/db/schema";
import { pickLocalized } from "@fekerte/core/lib/i18n";
import { requireBusiness } from "@/lib/auth/current";
import { getT } from "@/i18n/server";
import { PageHeader } from "@/components/ui/stat";
import { StaffManager } from "@/components/settings/staff-manager";

export const metadata = { title: "Staff" };

export default async function StaffPage() {
  const ctx = await requireBusiness();
  const { t, locale } = await getT();
  const bid = ctx.business.id;
  const data = await withTenant(bid, async (tx) => ({
    staff: await listStaff(tx, bid),
    services: await listServices(tx, bid, { activeOnly: true }),
    links: await getStaffServiceLinks(tx, bid),
    hours: await tx.select().from(workingHours).where(eq(workingHours.businessId, bid)),
    businessHours: await getWeeklyHours(tx, bid, null),
    off: await tx.select().from(timeOff).where(and(eq(timeOff.businessId, bid), gte(timeOff.endsAt, new Date()))),
  }));
  return (
    <div>
      <PageHeader title={t("staff.title")} />
      <StaffManager
        readOnly={ctx.readOnly || ctx.role === "staff"}
        tz={ctx.business.timezone}
        businessHours={data.businessHours}
        services={data.services.map((s) => ({ id: s.id, name: pickLocalized(s.name, locale) }))}
        staff={data.staff.map((s) => ({
          id: s.id,
          name: s.name,
          title: s.title,
          color: s.color,
          phone: s.phone,
          email: s.email,
          active: s.active,
          bookableOnline: s.bookableOnline,
          serviceIds: data.links.filter((l) => l.staffId === s.id).map((l) => l.serviceId),
          hours: data.hours
            .filter((h) => h.staffId === s.id)
            .map((h) => ({ weekday: h.weekday, start: h.startTime.slice(0, 5), end: h.endTime.startsWith("24") ? "24:00" : h.endTime.slice(0, 5) }))
            .sort((a, b) => a.weekday - b.weekday || a.start.localeCompare(b.start)),
          timeOff: data.off
            .filter((o) => o.staffId === s.id)
            .map((o) => ({ id: o.id, startsAt: o.startsAt.toISOString(), endsAt: o.endsAt.toISOString(), reason: o.reason })),
        }))}
      />
    </div>
  );
}
