import { expect, test } from "@playwright/test";
import { DEMO_OWNER, login } from "./helpers";

test("analytics dashboard shows ROI, charts and private feedback", async ({ page }) => {
  await login(page, DEMO_OWNER.email, DEMO_OWNER.password);
  await page.goto("/dashboard/analytics?lang=en&range=30");
  await expect(page.getByRole("heading", { name: "Analytics" })).toBeVisible();
  await expect(page.getByTestId("hero-ai-bookings")).toHaveText(/\d+/);
  await expect(page.getByText("Bookings by source")).toBeVisible();
  await expect(page.getByText("Busiest hours")).toBeVisible();
  await expect(page.getByTestId("private-feedback")).toContainText("Waited 35 minutes");
  await page.getByText("Show as table").first().click();
  await expect(page.locator("details[open] table")).toBeVisible();
});

test("CRM segments and the customer timeline", async ({ page }) => {
  await login(page, DEMO_OWNER.email, DEMO_OWNER.password);
  await page.goto("/dashboard/customers?lang=en");
  await page.getByTestId("segment-vip").click();
  await page.waitForURL(/segment=vip/);
  const first = page.locator("ul li a[href^='/dashboard/customers/']").first();
  await expect(first).toContainText("VIP");
  await first.click();
  await expect(page.getByTestId("customer-timeline")).toBeVisible();
  await expect(page.getByTestId("customer-timeline")).toContainText(/Booked .* with/);
});

test("owner sends a WhatsApp campaign to a segment", async ({ page }) => {
  await login(page, DEMO_OWNER.email, DEMO_OWNER.password);
  await page.goto("/dashboard/campaigns?lang=en&segment=vip");
  await expect(page.getByTestId("campaign-audience")).toContainText(/\d+ of \d+ customers/);
  const name = `E2E campaign ${Date.now()}`;
  const form = page.locator("[data-slot=card]").filter({ hasText: "New campaign" });
  await form.getByLabel("Campaign name").fill(name);
  await form.getByLabel("Message").fill("Free fluoride treatment with every checkup this week.");
  await form.getByRole("button", { name: "Send now" }).click();
  await expect(page.getByText("Campaign scheduled")).toBeVisible();
  const row = page.getByTestId("campaign-row").filter({ hasText: name });
  await expect(row).toBeVisible();
  // The job worker (voice server / cron) sends it within a few seconds.
  await expect(async () => {
    await page.reload();
    await expect(page.getByTestId("campaign-row").filter({ hasText: name })).toContainText("Sent", { timeout: 2000 });
  }).toPass({ timeout: 45_000 });
});

test("deposit: online booking is held, staff marks the deposit received", async ({ page }) => {
  await page.goto("/b/demo-dental?lang=en");
  await page.getByText("Teeth whitening").click();
  const days = page.locator("button.w-14:not([disabled])");
  await expect(days.first()).toBeVisible();
  await days.nth(Math.min(4, (await days.count()) - 1)).click();
  await page.locator("button.ltr-nums.h-11").first().click();
  const name = `Deposit Patient ${String(Date.now()).slice(-6)}`;
  await page.fill("#bk-name", name);
  await page.fill("#bk-phone", `71 ${String(Date.now()).slice(-6)}`);
  await page.getByRole("button", { name: "Confirm booking" }).click();
  await expect(page.getByTestId("deposit-notice")).toContainText("$50");
  const manage = await page.getByRole("link", { name: "Change or cancel" }).getAttribute("href");
  await page.goto(manage!);
  await expect(page.getByTestId("manage-deposit")).toContainText("$50");

  await login(page, DEMO_OWNER.email, DEMO_OWNER.password);
  await page.goto(`/dashboard/appointments?lang=en&q=${encodeURIComponent(name)}`);
  await page.getByRole("button", { name: new RegExp(name) }).first().click();
  const sheet = page.getByRole("dialog");
  await expect(sheet.getByTestId("deposit-box")).toContainText("Deposit $50 required");
  await sheet.getByRole("button", { name: "Deposit received" }).click();
  await sheet.getByLabel("Reference (optional)").fill("WHISH-E2E");
  await sheet.getByRole("button", { name: "Deposit received" }).click();
  await expect(page.getByText("Deposit recorded — appointment confirmed")).toBeVisible();
});
