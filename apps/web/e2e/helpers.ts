import { expect, type Page } from "@playwright/test";

export async function login(page: Page, email: string, password: string, lang = "en") {
  await page.goto(`/login?lang=${lang}`);
  await page.fill("#email", email);
  await page.fill("#password", password);
  await page.locator("form").first().getByRole("button", { name: /Sign in|تسجيل الدخول|Se connecter/ }).click();
  await page.waitForURL(/\/(dashboard|admin|onboarding)/);
  await expect(page.locator("body")).toBeVisible();
}

export const DEMO_OWNER = { email: "owner@demo-dental.com", password: "demo12345" };
export const SUPER_ADMIN = { email: process.env.SEED_ADMIN_EMAIL ?? "admin@fekerte.app", password: process.env.SEED_ADMIN_PASSWORD ?? "admin12345" };
