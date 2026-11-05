import { expect, test } from "@playwright/test";

test("a new owner signs up, onboards in a few steps and the booking page is live", async ({ page }) => {
  const stamp = Date.now();
  await page.goto("/signup?lang=en");
  await page.fill("#name", "Dr. Test Owner");
  await page.fill("#email", `owner-${stamp}@e2e.test`);
  await page.fill("#password", "password123");
  await page.getByRole("button", { name: "Create account" }).click();

  await page.waitForURL("**/onboarding");
  await page.getByPlaceholder("Clinique Dr. ...").fill(`E2E Physio ${stamp}`);
  await page.getByRole("button", { name: /Physiotherapy/ }).click();
  await page.getByRole("button", { name: "Continue" }).click();

  // Services pre-filled from the physio preset.
  await expect(page.locator("input[value='Initial assessment']")).toBeVisible();
  await page.getByRole("button", { name: "Continue" }).click();

  // Team & hours
  await expect(page.locator("input[value='Dr. Test Owner']")).toBeVisible();
  await page.getByRole("button", { name: "Publish booking page" }).click();
  await expect(page.getByText("Your booking page is live")).toBeVisible();
  const link = await page.locator("code").innerText();
  expect(link).toContain("/b/e2e-physio-");

  await page.goto(new URL(link).pathname + "?lang=en");
  await expect(page.getByText("Initial assessment")).toBeVisible();
  await expect(page.getByText("Physiotherapy session")).toBeVisible();

  await page.goto("/dashboard");
  await expect(page.getByRole("heading", { name: /Hello/ })).toBeVisible();
});
