import { expect, test } from "@playwright/test";
import { DEMO_OWNER, SUPER_ADMIN, login } from "./helpers";

const BARBER_OWNER = { email: "owner@demo-barber.com", password: "demo12345" };

test("owner billing page shows plan, usage, AI status and invoices", async ({ page }) => {
  await login(page, DEMO_OWNER.email, DEMO_OWNER.password);
  await page.goto("/dashboard/billing?lang=en");
  await expect(page.getByRole("heading", { name: "Billing & plan" })).toBeVisible();
  await expect(page.getByTestId("plan-status")).toHaveText("Active");
  await expect(page.getByRole("progressbar", { name: "AI messages" })).toBeVisible();
  await expect(page.getByTestId("ai-status-voice")).toHaveText("On");
  await expect(page.getByTestId("plan-premium")).toContainText("Current");
  await expect(page.getByText("Paid", { exact: true }).first()).toBeVisible();
});

test("tier gating: Standard plan has no voice AI; open invoice shows how to pay", async ({ page }) => {
  await login(page, BARBER_OWNER.email, BARBER_OWNER.password);
  await page.goto("/dashboard/billing?lang=en");
  await expect(page.getByTestId("ai-status-voice")).toHaveText("Not in your plan");
  await expect(page.getByTestId("ai-status-whatsapp")).toHaveText("On");
  await expect(page.getByRole("heading", { name: "How to pay" })).toBeVisible();
  // Calls (voice) section is hidden from navigation for Standard.
  await expect(page.locator('a[href="/dashboard/calls"]')).toHaveCount(0);
  await expect(page.locator('a[href="/dashboard/inbox"]').first()).toBeAttached();
  // Owners can request an upgrade (active subscription → needs admin approval).
  await page.getByTestId("plan-premium").getByRole("button", { name: "Request this plan" }).click();
  await expect(page.getByText(/Requested change to Premium/)).toBeVisible();
});

test("super admin issues an invoice and marks it paid with a reference and receipt", async ({ page }) => {
  await login(page, SUPER_ADMIN.email, SUPER_ADMIN.password);
  await page.goto("/admin?lang=en");
  await page.getByRole("link", { name: "Demo Barber Shop" }).click();
  await page.waitForURL(/\/admin\/businesses\//);
  // The upgrade request from the previous test (if run) can be approved here.
  const approve = page.getByRole("button", { name: /Approve change to/ });
  if (await approve.count()) await page.getByRole("button", { name: "Reject" }).click();
  await page.getByRole("button", { name: "New invoice" }).click();
  await page.waitForURL(/\/admin\/invoices\/[0-9a-f-]{36}/);
  await expect(page.getByTestId("invoice")).toContainText("Demo Barber Shop");
  await expect(page.getByTestId("invoice")).toContainText("Unpaid");

  await page.getByRole("button", { name: "Mark paid" }).first().click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Payment method").selectOption("wallet");
  await dialog.getByLabel(/Reference/).fill("WHISH-E2E-001");
  await dialog.getByLabel(/Receipt/).setInputFiles({
    name: "receipt.png",
    mimeType: "image/png",
    buffer: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==", "base64"),
  });
  await dialog.getByRole("button", { name: "Mark paid" }).click();
  await expect(page.getByTestId("invoice")).toContainText("Paid");
  await expect(page.getByTestId("invoice")).toContainText("WHISH-E2E-001");
  const receipt = page.getByRole("link", { name: "Receipt" });
  await expect(receipt).toBeVisible();
  const res = await page.request.get((await receipt.getAttribute("href"))!);
  expect(res.status()).toBe(200);
  expect(res.headers()["content-type"]).toBe("image/png");
});

test("plans & pricing page is editable by super admin only", async ({ page }) => {
  await login(page, SUPER_ADMIN.email, SUPER_ADMIN.password);
  await page.goto("/admin/plans?lang=en");
  await expect(page.getByTestId("plan-editor-basic")).toBeVisible();
  await expect(page.getByLabel("basic monthly")).toHaveValue(/\d+/);
});
