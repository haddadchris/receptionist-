/** Public (unauthenticated) business lookups for booking pages, widgets and webhooks. */
import { and, eq } from "drizzle-orm";
import { withSystem, withTenant } from "../db/tenant";
import { businesses, staff, staffServices, type Business } from "../db/schema";
import { publicServices } from "./setup";

/** Resolve a business by its public slug (system context — only public fields are used by callers). */
export async function getBusinessBySlug(slug: string): Promise<Business | null> {
  if (!/^[a-z0-9-]{2,60}$/.test(slug)) return null;
  const [b] = await withSystem((tx) => tx.select().from(businesses).where(eq(businesses.slug, slug)));
  if (!b || b.status === "cancelled") return null;
  return b;
}

export async function getBusinessByWhatsAppPhoneId(phoneNumberId: string): Promise<Business | null> {
  const [b] = await withSystem((tx) => tx.select().from(businesses).where(eq(businesses.whatsappPhoneNumberId, phoneNumberId)));
  return b ?? null;
}

export async function getBusinessByVoiceNumber(e164: string): Promise<Business | null> {
  const [b] = await withSystem((tx) => tx.select().from(businesses).where(eq(businesses.voiceNumber, e164)));
  return b ?? null;
}

export type PublicCatalog = {
  services: Awaited<ReturnType<typeof publicServices>>;
  staff: { id: string; name: string; title: Business["branding"]["tagline"]; color: string; serviceIds: string[] }[];
};

export async function getPublicCatalog(businessId: string): Promise<PublicCatalog> {
  return withTenant(businessId, async (tx) => {
    const services = await publicServices(tx, businessId);
    const rows = await tx
      .select({ staff, serviceId: staffServices.serviceId })
      .from(staff)
      .innerJoin(staffServices, eq(staffServices.staffId, staff.id))
      .where(and(eq(staff.businessId, businessId), eq(staff.active, true), eq(staff.bookableOnline, true)))
      .orderBy(staff.sortOrder);
    const byId = new Map<string, PublicCatalog["staff"][number]>();
    for (const r of rows) {
      const cur = byId.get(r.staff.id) ?? { id: r.staff.id, name: r.staff.name, title: r.staff.title, color: r.staff.color, serviceIds: [] };
      cur.serviceIds.push(r.serviceId);
      byId.set(r.staff.id, cur);
    }
    return { services, staff: [...byId.values()] };
  });
}
