"use server";

import { cookies } from "next/headers";
import { z } from "zod";
import { withSystem } from "@fekerte/core/db/tenant";
import { getUserById, getUserMemberships } from "@fekerte/core/auth/users";
import { getBusiness } from "@fekerte/core/availability/loader";
import { withTenant } from "@fekerte/core/db/tenant";
import { getAuth } from "@/lib/auth/adapter";
import { clientIp, rateLimit } from "@/lib/rate-limit";
import { getT } from "@/i18n/server";
import { LOCALE_COOKIE } from "@/i18n";

type Result = { ok: true; redirectTo: string } | { ok: false; error: string; devLink?: string; info?: string };

const safeNext = (next: unknown) => (typeof next === "string" && next.startsWith("/") && !next.startsWith("//") ? next : null);

/** After sign-in: pick the landing page and default the UI language to the business setting. */
async function landing(userId: string, next: string | null): Promise<string> {
  const { user, memberships } = await withSystem(async (tx) => ({
    user: await getUserById(tx, userId),
    memberships: await getUserMemberships(tx, userId),
  }));
  const store = await cookies();
  let locale = user?.locale ?? null;
  if (!locale && memberships[0]) {
    const biz = await withTenant(memberships[0].businessId, (tx) => getBusiness(tx, memberships[0]!.businessId));
    locale = biz.defaultLanguage;
  }
  if (locale && !store.get(LOCALE_COOKIE)) store.set(LOCALE_COOKIE, locale, { path: "/", maxAge: 31536000, sameSite: "lax" });
  if (next) return next;
  if (!memberships.length) return user?.isSuperAdmin ? "/admin" : "/onboarding";
  return memberships[0]!.onboarded ? "/dashboard" : "/onboarding";
}

const loginSchema = z.object({ email: z.string().trim().email(), password: z.string().min(1) });

export async function loginAction(_: unknown, form: FormData): Promise<Result> {
  const { t } = await getT();
  const ip = await clientIp();
  if (!rateLimit(`login:${ip}`, 10, 60_000).ok) return { ok: false, error: t("errors.rateLimited") };
  const parsed = loginSchema.safeParse({ email: form.get("email"), password: form.get("password") });
  if (!parsed.success) return { ok: false, error: t("auth.invalidCredentials") };
  const res = await getAuth().signIn(parsed.data.email, parsed.data.password);
  if ("error" in res) return { ok: false, error: t("auth.invalidCredentials") };
  return { ok: true, redirectTo: await landing(res.userId, safeNext(form.get("next"))) };
}

export async function magicLinkAction(_: unknown, form: FormData): Promise<Result> {
  const { t } = await getT();
  const ip = await clientIp();
  if (!rateLimit(`magic:${ip}`, 5, 60_000).ok) return { ok: false, error: t("errors.rateLimited") };
  const email = z.string().trim().email().safeParse(form.get("email"));
  if (!email.success) return { ok: false, error: t("auth.invalidCredentials") };
  const res = await getAuth().sendMagicLink(email.data, safeNext(form.get("next")) ?? "/dashboard");
  return { ok: false, error: "", info: t("auth.magicLinkSent"), devLink: res.devLink };
}

const signupSchema = z.object({
  name: z.string().trim().min(2).max(100),
  email: z.string().trim().email(),
  password: z.string().min(8).max(200),
});

export async function signupAction(_: unknown, form: FormData): Promise<Result> {
  const { t } = await getT();
  const ip = await clientIp();
  if (!rateLimit(`signup:${ip}`, 5, 60_000).ok) return { ok: false, error: t("errors.rateLimited") };
  const parsed = signupSchema.safeParse({ name: form.get("name"), email: form.get("email"), password: form.get("password") });
  if (!parsed.success) return { ok: false, error: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join(" · ") };
  const res = await getAuth().signUp(parsed.data);
  if ("error" in res) return { ok: false, error: res.error };
  return { ok: true, redirectTo: "/onboarding" };
}
