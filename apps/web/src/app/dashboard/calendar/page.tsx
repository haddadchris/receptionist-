import { DateTime } from "luxon";
import { withTenant } from "@fekerte/core/db/tenant";
import { listAppointments } from "@fekerte/core/booking/service";
import { getStaffServiceLinks, listServices, listStaff } from "@fekerte/core/business/setup";
import { loadCalendarInput } from "@fekerte/core/availability/loader";
import { workingWindows } from "@fekerte/core/availability/engine";
import { requireBusiness } from "@/lib/auth/current";
import { getLocale } from "@/i18n/server";
import { toApptDTO, toServiceOptions, toStaffOptions } from "@/lib/dto";
import { Calendar } from "@/components/calendar/calendar";

export const metadata = { title: "Calendar" };

export default async function CalendarPage({ searchParams }: { searchParams: Promise<{ date?: string; view?: string; staff?: string }> }) {
  const sp = await searchParams;
  const ctx = await requireBusiness();
  const locale = await getLocale();
  const tz = ctx.business.timezone;
  const view = sp.view === "week" ? "week" : "day";
  const anchor = sp.date && /^\d{4}-\d{2}-\d{2}$/.test(sp.date) ? DateTime.fromISO(sp.date, { zone: tz }) : DateTime.now().setZone(tz);
  const start = view === "day" ? anchor.startOf("day") : anchor.startOf("week");
  const days = Array.from({ length: view === "day" ? 1 : 7 }, (_, i) => start.plus({ days: i }).toISODate()!);
  const from = start.toJSDate();
  const to = start.plus({ days: days.length }).toJSDate();

  const data = await withTenant(ctx.business.id, async (tx) => {
    const [appts, staff, services, links, input] = await Promise.all([
      listAppointments(tx, ctx.business.id, { from, to }),
      listStaff(tx, ctx.business.id, { activeOnly: true }),
      listServices(tx, ctx.business.id, { activeOnly: true }),
      getStaffServiceLinks(tx, ctx.business.id),
      loadCalendarInput(tx, ctx.business.id, days[0]!, days.at(-1)!),
    ]);
    const windows: Record<string, { start: string; end: string }[]> = {};
    for (const d of days) {
      const w = workingWindows(input, d);
      for (const [staffId, list] of Object.entries(w)) windows[`${d}|${staffId}`] = list;
    }
    return { appts, staff, services, links, windows };
  });

  const staffOptions = toStaffOptions(data.staff);
  const selectedStaffId = sp.staff && staffOptions.some((s) => s.id === sp.staff) ? sp.staff : null;

  return (
    <Calendar
      view={view}
      date={anchor.toISODate()!}
      days={days}
      tz={tz}
      staff={staffOptions}
      selectedStaffId={selectedStaffId}
      appointments={data.appts.map((a) => toApptDTO(a, locale))}
      windows={data.windows}
      services={toServiceOptions(data.services, data.links, locale)}
      readOnly={ctx.readOnly}
    />
  );
}
