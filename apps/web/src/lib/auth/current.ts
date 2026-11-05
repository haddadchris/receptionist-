import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { withSystem, withTenant } from "@fekerte/core/db/tenant";
import { getUserById, getUserMemberships, type MembershipView } from "@fekerte/core/auth/users";
import { getBusiness } from "@fekerte/core/availability/loader";
import { businesses, type Business, type User } from "@fekerte/core/db/schema";
import { DomainError } from "@fekerte/core/lib/errors";
import type { Actor } from "@fekerte/core/lib/audit";
import { getAuth } from "./adapter";

export const BUSINESS_COOKIE = "fk_biz";
export const IMPERSONATE_COOKIE = "fk_impersonate";

export const getCurrentUser = cache(async (): Promise<User | null> => {
  const id = await getAuth().getUserId();
  if (!id) return null;
  return withSystem((tx) => getUserById(tx, id));
});

export async function requireUser(): Promise<User> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  return user;
}

export async function requireSuperAdmin(): Promise<User> {
  const user = await requireUser();
  if (!user.isSuperAdmin) redirect("/dashboard");
  return user;
}

export type BusinessContext = {
  user: User;
  business: Business;
  role: "owner" | "staff" | "super_admin";
  readOnly: boolean;
  memberships: MembershipView[];
  actor: Actor;
};

export const getBusinessContext = cache(async (): Promise<BusinessContext | null> => {
  const user = await getCurrentUser();
  if (!user) return null;
  const store = await cookies();
  const impersonating = store.get(IMPERSONATE_COOKIE)?.value;
  const memberships = await withSystem((tx) => getUserMemberships(tx, user.id));
  const actor: Actor = { type: "user", userId: user.id, label: user.name ?? user.email };

  if (impersonating && user.isSuperAdmin) {
    const [biz] = await withSystem((tx) => tx.select().from(businesses).where(eq(businesses.id, impersonating)));
    if (biz) return { user, business: biz, role: "super_admin", readOnly: true, memberships, actor };
  }
  if (!memberships.length) return null;
  const selectedId = store.get(BUSINESS_COOKIE)?.value;
  const membership = memberships.find((m) => m.businessId === selectedId) ?? memberships[0]!;
  const business = await withTenant(membership.businessId, (tx) => getBusiness(tx, membership.businessId));
  return { user, business, role: membership.role, readOnly: false, memberships, actor };
});

/** For dashboard pages: redirects to login/onboarding as needed. */
export async function requireBusiness(opts: { allowIncompleteOnboarding?: boolean } = {}): Promise<BusinessContext> {
  const user = await requireUser();
  const ctx = await getBusinessContext();
  if (!ctx) redirect(user.isSuperAdmin ? "/admin" : "/onboarding");
  if (!opts.allowIncompleteOnboarding && !ctx.business.onboardingCompletedAt && !ctx.readOnly) redirect("/onboarding");
  return ctx;
}

/** For server actions: throws instead of redirecting, and refuses read-only (impersonation) sessions. */
export async function requireWritableBusiness(opts: { ownerOnly?: boolean } = {}): Promise<BusinessContext> {
  const ctx = await getBusinessContext();
  if (!ctx) throw new DomainError("FORBIDDEN", "Not signed in");
  if (ctx.readOnly) throw new DomainError("FORBIDDEN", "Read-only session");
  if (opts.ownerOnly && ctx.role !== "owner") throw new DomainError("FORBIDDEN", "Owner only");
  return ctx;
}
