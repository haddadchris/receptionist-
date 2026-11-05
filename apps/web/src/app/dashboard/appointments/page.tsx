import Link from "next/link";
import { withTenant } from "@fekerte/core/db/tenant";
import { listAppointments } from "@fekerte/core/booking/service";
import { listStaff } from "@fekerte/core/business/setup";
import type { AppointmentSource, AppointmentStatus } from "@fekerte/core/db/schema";
import { requireBusiness } from "@/lib/auth/current";
import { getT } from "@/i18n/server";
import { toApptDTO } from "@/lib/dto";
import { PageHeader } from "@/components/ui/stat";
import { Input, Select } from "@/components/ui/form";
import { Button } from "@/components/ui/button";
import { AppointmentList } from "@/components/appointments/appointment-list";
import { cn } from "@/lib/utils";

export const metadata = { title: "Appointments" };

const STATUSES: AppointmentStatus[] = ["pending", "confirmed", "completed", "no_show", "cancelled"];
const SOURCES: AppointmentSource[] = ["dashboard", "booking_page", "whatsapp", "voice", "web_chat"];

export default async function AppointmentsPage({
  searchParams,
}: {
  searchParams: Promise<{ when?: string; status?: string; staff?: string; source?: string; q?: string }>;
}) {
  const sp = await searchParams;
  const ctx = await requireBusiness();
  const { t, locale } = await getT();
  const when = sp.when === "past" || sp.when === "all" ? sp.when : "upcoming";
  const status = STATUSES.includes(sp.status as AppointmentStatus) ? (sp.status as AppointmentStatus) : undefined;
  const source = SOURCES.includes(sp.source as AppointmentSource) ? (sp.source as AppointmentSource) : undefined;
  const now = new Date();

  const { appts, staff } = await withTenant(ctx.business.id, async (tx) => ({
    appts: await listAppointments(tx, ctx.business.id, {
      from: when === "upcoming" ? now : undefined,
      to: when === "past" ? now : undefined,
      statuses: status ? [status] : undefined,
      staffId: sp.staff || null,
      source,
      search: sp.q?.slice(0, 60),
      order: when === "upcoming" ? "asc" : "desc",
      limit: 200,
    }),
    staff: await listStaff(tx, ctx.business.id),
  }));

  const tab = (w: string) => {
    const q = new URLSearchParams({ ...(sp as Record<string, string>), when: w });
    return `/dashboard/appointments?${q.toString()}`;
  };

  return (
    <div>
      <PageHeader title={t("appointments.title")} />
      <div className="mb-3 inline-flex rounded-lg border p-0.5">
        {(["upcoming", "past", "all"] as const).map((w) => (
          <Link key={w} href={tab(w)} className={cn("rounded-md px-3 py-1.5 text-sm", when === w ? "bg-primary text-primary-foreground" : "text-muted-foreground")}>
            {t(`appointments.${w}`)}
          </Link>
        ))}
      </div>
      <form className="mb-4 grid gap-2 sm:grid-cols-[1fr_auto_auto_auto_auto]">
        <input type="hidden" name="when" value={when} />
        <Input name="q" defaultValue={sp.q} placeholder={t("appointments.searchPlaceholder")} />
        <Select name="status" defaultValue={status ?? ""}>
          <option value="">{t("common.all")}</option>
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {t(`status.${s}`)}
            </option>
          ))}
        </Select>
        <Select name="staff" defaultValue={sp.staff ?? ""}>
          <option value="">{t("calendar.allStaff")}</option>
          {staff.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </Select>
        <Select name="source" defaultValue={source ?? ""}>
          <option value="">{t("appointment.source")}</option>
          {SOURCES.map((s) => (
            <option key={s} value={s}>
              {t(`source.${s}`)}
            </option>
          ))}
        </Select>
        <Button type="submit" variant="secondary">
          {t("common.search")}
        </Button>
      </form>
      <AppointmentList appointments={appts.map((a) => toApptDTO(a, locale))} tz={ctx.business.timezone} readOnly={ctx.readOnly} />
    </div>
  );
}
