import { expect, type Cookie, type Page } from "@playwright/test";

/** Session cookies per user, so the suite logs in once per account (login is rate-limited per account). */
const sessions = new Map<string, Cookie[]>();

export async function login(page: Page, email: string, password: string, lang = "en") {
  const cached = sessions.get(email);
  if (cached) {
    await page.context().addCookies(cached);
    await page.goto(`/login?lang=${lang}`);
    if (!/\/login/.test(page.url())) return;
    // Proxy didn't redirect: fall through and sign in properly.
  }
  await page.goto(`/login?lang=${lang}`);
  await page.fill("#email", email);
  await page.fill("#password", password);
  await page.locator("form").first().getByRole("button", { name: /Sign in|تسجيل الدخول|Se connecter/ }).click();
  await page.waitForURL(/\/(dashboard|admin|onboarding)/);
  await expect(page.locator("body")).toBeVisible();
  sessions.set(
    email,
    (await page.context().cookies()).filter((c) => c.name === "fk_session"),
  );
}

export const DEMO_OWNER = { email: "owner@demo-dental.com", password: "demo12345" };
export const SUPER_ADMIN = { email: process.env.SEED_ADMIN_EMAIL ?? "admin@fekerte.app", password: process.env.SEED_ADMIN_PASSWORD ?? "admin12345" };
