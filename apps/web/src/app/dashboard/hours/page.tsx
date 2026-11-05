import { and, asc, eq, gte } from "drizzle-orm";
import { withTenant } from "@fekerte/core/db/tenant";
import { getBreaks, getWeeklyHours } from "@fekerte/core/business/setup";
import { holidays, staff } from "@fekerte/core/db/schema";
import { requireBusiness } from "@/lib/auth/current";
import { getT } from "@/i18n/server";
import { PageHeader } from "@/components/ui/stat";
import { HoursForm } from "@/components/settings/hours-form";
import { todayIn } from "@/lib/format";

export const metadata = { title: "Hours" };

export default async function HoursPage() {
  const ctx = await requireBusiness();
  const { t } = await getT();
  const bid = ctx.business.id;
  const data = await withTenant(bid, async (tx) => ({
    hours: await getWeeklyHours(tx, bid, null),
    breaks: await getBreaks(tx, bid, null),
    holidays: await tx
      .select({ id: holidays.id, startDate: holidays.startDate, endDate: holidays.endDate, name: holidays.name, staffName: staff.name })
      .from(holidays)
      .leftJoin(staff, eq(staff.id, holidays.staffId))
      .where(and(eq(holidays.businessId, bid), gte(holidays.endDate, todayIn(ctx.business.timezone))))
      .orderBy(asc(holidays.startDate)),
  }));
  return (
    <div>
      <PageHeader title={t("hours.title")} />
      <HoursForm {...data} readOnly={ctx.readOnly || ctx.role === "staff"} />
    </div>
  );
}
