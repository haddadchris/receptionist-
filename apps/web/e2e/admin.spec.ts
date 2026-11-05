import { expect, test } from "@playwright/test";
import { DEMO_OWNER, SUPER_ADMIN, login } from "./helpers";

test("super admin sees all businesses and can impersonate read-only", async ({ page }) => {
  await login(page, SUPER_ADMIN.email, SUPER_ADMIN.password);
  await page.goto("/admin?lang=en");
  await expect(page.getByRole("link", { name: "Demo Dental Clinic" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Demo Barber Shop" })).toBeVisible();

  const row = page.getByRole("row", { name: /Demo Barber Shop/ });
  await row.getByRole("button", { name: "View as owner" }).click();
  await page.waitForURL("**/dashboard");
  await expect(page.getByText(/Read-only view/)).toBeVisible();
  await expect(page.getByText("Demo Barber Shop").first()).toBeVisible();
  await page.getByRole("button", { name: "Exit" }).click();
  await page.waitForURL("**/admin");
});

test("owners cannot open the admin panel", async ({ page }) => {
  await login(page, DEMO_OWNER.email, DEMO_OWNER.password);
  await page.goto("/admin");
  await page.waitForURL("**/dashboard");
});
