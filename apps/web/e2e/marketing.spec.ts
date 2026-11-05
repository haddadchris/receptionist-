import { expect, test } from "@playwright/test";
import { SUPER_ADMIN, login } from "./helpers";

test("marketing site is Arabic-first (RTL) with live pricing and an ROI calculator", async ({ page }) => {
  await page.goto("/?lang=ar");
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  await expect(page.getByRole("heading", { level: 1 })).toContainText("ولا زبون بيروح");
  await expect(page.getByTestId("pricing-standard")).toContainText("$79");
  await expect(page.getByTestId("pricing-premium")).toContainText("$199");

  await page.goto("/?lang=en");
  await expect(page.locator("html")).toHaveAttribute("dir", "ltr");
  await expect(page.getByTestId("roi-monthly")).toHaveText("$2,400"); // 5 × 24 × 40% × $50
  await page.getByLabel("Missed calls per day").fill("10");
  await expect(page.getByTestId("roi-monthly")).toHaveText("$4,800");
  await page.getByText("Is there a long contract?").click();
  await expect(page.getByText(/It's monthly/)).toBeVisible();
});

test("“Book a demo” creates a lead the admin moves through the pipeline", async ({ page }) => {
  const name = `E2E Lead ${Date.now()}`;
  await page.goto("/?lang=en&plan=standard#demo");
  const form = page.getByTestId("demo-form");
  await expect(form.getByLabel("Plan you're interested in")).toHaveValue("standard");
  await form.getByLabel("Your name").fill(name);
  await form.getByLabel("Business name").fill("E2E Physio");
  await form.getByLabel("Mobile (WhatsApp)").fill(`76 ${String(Date.now()).slice(-6)}`);
  await form.getByLabel("Type of business").selectOption("physio");
  await form.getByLabel("City").fill("Tripoli");
  await form.getByRole("button", { name: "Request my demo" }).click();
  await expect(page.getByTestId("demo-success")).toBeVisible();

  await login(page, SUPER_ADMIN.email, SUPER_ADMIN.password);
  await page.goto("/admin/leads?lang=en");
  const card = page.getByTestId("lead-column-new").getByTestId("lead-card").filter({ hasText: name });
  await expect(card).toContainText("E2E Physio");
  await expect(card).toContainText("Interested in: standard");
  await card.getByLabel("Move to").selectOption("demo_scheduled");
  await expect(page.getByTestId("lead-column-demo_scheduled").getByTestId("lead-card").filter({ hasText: name })).toBeVisible();
});

test("live demo page: chat with the demo clinic's AI receptionist", async ({ page }) => {
  await page.goto("/demo?lang=en");
  await expect(page.getByRole("heading", { name: "Try Fekerte now" })).toBeVisible();
  await page.getByTestId("chat-input").fill("How much is a cleaning?");
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("chat-messages")).toContainText("$60");
  // Public demo call (text mode, rate-limited demo token).
  await page.getByTestId("start-call").click();
  const transcript = page.getByTestId("call-transcript");
  await expect(transcript).toContainText(/Demo Dental Clinic/);
  await page.getByTestId("call-type").fill("How much is whitening?");
  await page.keyboard.press("Enter");
  await expect(transcript).toContainText(/250 dollars|\$250/);
});
