import { z } from "zod";
import { eq } from "drizzle-orm";
import { verifyManageToken } from "@fekerte/core/booking/tokens";
import { cancelBooking, rescheduleBooking } from "@fekerte/core/booking/service";
import { withSystem, withTenant } from "@fekerte/core/db/tenant";
import { appointments } from "@fekerte/core/db/schema";
import { apiError, json, limited } from "@/lib/api";

const body = z.discriminatedUnion("action", [
  z.object({ action: z.literal("cancel"), reason: z.string().max(300).optional() }),
  z.object({ action: z.literal("reschedule"), startsAt: z.string().datetime(), staffId: z.string().uuid().nullish() }),
]);

export async function POST(req: Request, ctx: { params: Promise<{ token: string }> }) {
  const tooMany = limited(req, "manage", 20);
  if (tooMany) return tooMany;
  try {
    const { token } = await ctx.params;
    const id = verifyManageToken(token);
    if (!id || !/^[0-9a-f-]{36}$/.test(id)) return json({ error: "Invalid link", code: "INVALID_TOKEN" }, { status: 400 });
    const [appt] = await withSystem((tx) => tx.select({ businessId: appointments.businessId }).from(appointments).where(eq(appointments.id, id)));
    if (!appt) return json({ error: "Not found" }, { status: 404 });
    const p = body.parse(await req.json());
    const actor = { type: "customer" as const, label: "manage link" };
    const updated = await withTenant(appt.businessId, (tx) =>
      p.action === "cancel"
        ? cancelBooking(tx, appt.businessId, id, { actor, reason: p.reason ?? "Cancelled by customer online" })
        : rescheduleBooking(tx, appt.businessId, id, { startsAt: p.startsAt, staffId: p.staffId ?? null, actor }),
    );
    return json({ id: updated.id, status: updated.status, startsAt: updated.startsAt });
  } catch (e) {
    return apiError(e);
  }
}
