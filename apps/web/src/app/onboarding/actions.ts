"use server";

import { cookies } from "next/headers";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { withSystem, withTenant } from "@fekerte/core/db/tenant";
import { businesses, services as servicesTable, staff as staffTable } from "@fekerte/core/db/schema";
import { getUserMemberships } from "@fekerte/core/auth/users";
import {
  completeOnboarding,
  createBusiness,
  createService,
  createStaff,
  listServices,
  setWeeklyHours,
} from "@fekerte/core/business/setup";
import { DomainError } from "@fekerte/core/lib/errors";
import { normalizePhone } from "@fekerte/core/lib/phone";
import { runAction } from "@/lib/actions";
import { BUSINESS_COOKIE, requireUser } from "@/lib/auth/current";
import { LOCALE_COOKIE } from "@/i18n";

const verticals = ["dental", "clinic", "physio", "aesthetic", "salon", "barber", "other"] as const;

async function ownedIncompleteBusiness(userId: string): Promise<string | null> {
  const memberships = await withSystem((tx) => getUserMemberships(tx, userId));
  const m = memberships.find((x) => x.role === "owner" && !x.onboarded);
  return m?.businessId ?? null;
}

async function requireOwnedBusiness(userId: string, businessId: string) {
  const memberships = await withSystem((tx) => getUserMemberships(tx, userId));
  if (!memberships.some((m) => m.businessId === businessId && m.role === "owner")) throw new DomainError("FORBIDDEN", "Not the owner");
}

export async function saveBusinessStep(input: {
  name: string;
  vertical: (typeof verticals)[number];
  phone?: string;
  city?: string;
  defaultLanguage: "ar" | "en" | "fr";
}) {
  return runAction(async () => {
    const user = await requireUser();
    const p = z
      .object({
        name: z.string().trim().min(2).max(120),
        vertical: z.enum(verticals),
        phone: z.string().max(30).optional(),
        city: z.string().max(80).optional(),
        defaultLanguage: z.enum(["ar", "en", "fr"]),
      })
      .parse(input);
    const phone = p.phone ? normalizePhone(p.phone) : null;
    const existing = await ownedIncompleteBusiness(user.id);
    let businessId = existing;
    if (existing) {
      await withTenant(existing, (tx) =>
        tx
          .update(businesses)
          .set({ name: p.name, vertical: p.vertical, phone, city: p.city || null, defaultLanguage: p.defaultLanguage })
          .where(eq(businesses.id, existing)),
      );
    } else {
      const biz = await withSystem((tx) =>
        createBusiness(tx, { ownerUserId: user.id, name: p.name, vertical: p.vertical, phone, city: p.city || null, defaultLanguage: p.defaultLanguage }),
      );
      businessId = biz.id;
    }
    const store = await cookies();
    store.set(BUSINESS_COOKIE, businessId!, { path: "/", httpOnly: true, sameSite: "lax", maxAge: 31536000 });
    store.set(LOCALE_COOKIE, p.defaultLanguage, { path: "/", sameSite: "lax", maxAge: 31536000 });
    return { businessId: businessId! };
  });
}

const serviceItem = z.object({
  name: z.string().trim().min(1).max(120),
  durationMinutes: z.number().int().min(5).max(600),
  priceCents: z.number().int().min(0).nullable(),
  nameTranslations: z.object({ ar: z.string().optional(), en: z.string().optional(), fr: z.string().optional() }).optional(),
});

export async function saveServicesStep(input: { businessId: string; locale: "ar" | "en" | "fr"; services: z.infer<typeof serviceItem>[] }) {
  return runAction(async () => {
    const user = await requireUser();
    const p = z.object({ businessId: z.string().uuid(), locale: z.enum(["ar", "en", "fr"]), services: z.array(serviceItem).min(1).max(50) }).parse(input);
    await requireOwnedBusiness(user.id, p.businessId);
    await withTenant(p.businessId, async (tx) => {
      // Onboarding owns the catalog until it completes: replace it.
      await tx.delete(servicesTable).where(eq(servicesTable.businessId, p.businessId));
      for (const s of p.services) {
        await createService(tx, p.businessId, {
          name: { ...(s.nameTranslations ?? {}), [p.locale]: s.name },
          durationMinutes: s.durationMinutes,
          priceCents: s.priceCents,
        });
      }
    });
    return null;
  });
}

const rule = z.object({ weekday: z.number().int().min(1).max(7), start: z.string(), end: z.string() });

export async function saveTeamStep(input: { businessId: string; hours: z.infer<typeof rule>[]; staff: { name: string; title?: string }[]; locale: "ar" | "en" | "fr" }) {
  return runAction(async () => {
    const user = await requireUser();
    const p = z
      .object({
        businessId: z.string().uuid(),
        hours: z.array(rule).min(1),
        staff: z.array(z.object({ name: z.string().trim().min(1).max(80), title: z.string().max(80).optional() })).min(1).max(30),
        locale: z.enum(["ar", "en", "fr"]),
      })
      .parse(input);
    await requireOwnedBusiness(user.id, p.businessId);
    const slug = await withTenant(p.businessId, async (tx) => {
      await setWeeklyHours(tx, p.businessId, null, p.hours);
      await tx.delete(staffTable).where(eq(staffTable.businessId, p.businessId));
      const svc = await listServices(tx, p.businessId);
      for (const s of p.staff) {
        await createStaff(tx, p.businessId, { name: s.name, title: s.title ? { [p.locale]: s.title } : {}, serviceIds: svc.map((x) => x.id) });
      }
      await completeOnboarding(tx, p.businessId);
      const [b] = await tx.select({ slug: businesses.slug }).from(businesses).where(eq(businesses.id, p.businessId));
      return b!.slug;
    });
    return { slug };
  });
}
