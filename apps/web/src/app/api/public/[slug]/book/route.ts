import { z } from "zod";
import { getBusinessBySlug } from "@fekerte/core/business/public";
import { createBooking } from "@fekerte/core/booking/service";
import { manageUrl } from "@fekerte/core/booking/tokens";
import { withTenant } from "@fekerte/core/db/tenant";
import { apiError, CORS_HEADERS, json, limited } from "@/lib/api";

const body = z.object({
  serviceId: z.string().uuid(),
  staffId: z.string().uuid().nullish(),
  startsAt: z.string().datetime(),
  name: z.string().trim().min(2).max(120),
  phone: z.string().trim().min(6).max(30),
  notes: z.string().max(1000).optional(),
  language: z.enum(["ar", "en", "fr"]).optional(),
  consentMarketing: z.boolean().optional(),
  /** Honeypot: must stay empty. */
  website: z.string().max(0).optional(),
  source: z.enum(["booking_page", "web_chat"]).optional(),
});

export function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}

export async function POST(req: Request, ctx: { params: Promise<{ slug: string }> }) {
  const tooMany = limited(req, "book", 10);
  if (tooMany) return tooMany;
  try {
    const { slug } = await ctx.params;
    const business = await getBusinessBySlug(slug);
    if (!business) return json({ error: "Not found" }, { status: 404 });
    const p = body.parse(await req.json());
    const appt = await withTenant(business.id, (tx) =>
      createBooking(tx, business.id, {
        serviceId: p.serviceId,
        staffId: p.staffId ?? null,
        startsAt: p.startsAt,
        customer: { phone: p.phone, name: p.name, language: p.language, consentMarketing: p.consentMarketing },
        notes: p.notes,
        source: p.source ?? "booking_page",
        actor: { type: "customer", label: p.name },
      }),
    );
    return json(
      {
        id: appt.id,
        status: appt.status,
        startsAt: appt.startsAt,
        endsAt: appt.endsAt,
        staffId: appt.staffId,
        manageUrl: manageUrl(business.slug, appt.id),
        deposit: appt.depositStatus === "required" ? { cents: appt.depositCents, dueAt: appt.depositDueAt } : null,
      },
      { status: 201, headers: CORS_HEADERS },
    );
  } catch (e) {
    return apiError(e);
  }
}
