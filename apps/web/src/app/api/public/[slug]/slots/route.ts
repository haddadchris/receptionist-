import { z } from "zod";
import { DateTime } from "luxon";
import { getBusinessBySlug } from "@fekerte/core/business/public";
import { getAvailableSlots } from "@fekerte/core/booking/service";
import { withTenant } from "@fekerte/core/db/tenant";
import { apiError, json, limited } from "@/lib/api";

const query = z.object({
  serviceId: z.string().uuid(),
  staffId: z.string().uuid().optional(),
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  days: z.coerce.number().int().min(1).max(31).optional(),
});

export async function GET(req: Request, ctx: { params: Promise<{ slug: string }> }) {
  const tooMany = limited(req, "slots", 90);
  if (tooMany) return tooMany;
  try {
    const { slug } = await ctx.params;
    const business = await getBusinessBySlug(slug);
    if (!business) return json({ error: "Not found" }, { status: 404 });
    const q = query.parse(Object.fromEntries(new URL(req.url).searchParams));
    const tz = business.timezone;
    const from = q.from ?? DateTime.now().setZone(tz).toISODate()!;
    const to = DateTime.fromISO(from).plus({ days: (q.days ?? 14) - 1 }).toISODate()!;
    const slots = await withTenant(business.id, (tx) =>
      getAvailableSlots(tx, business.id, { serviceId: q.serviceId, staffId: q.staffId ?? null, fromDate: from, toDate: to, channel: "public" }),
    );
    return json({ timezone: tz, from, to, slots: slots.map((s) => ({ start: s.start, end: s.end, staffIds: s.staffIds })) });
  } catch (e) {
    return apiError(e);
  }
}
