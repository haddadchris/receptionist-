import { expect, test } from "@playwright/test";
import { DEMO_OWNER, login } from "./helpers";

test("WhatsApp simulator: customer books through the AI and staff takes over", async ({ page }) => {
  await login(page, DEMO_OWNER.email, DEMO_OWNER.password);
  await page.goto("/dashboard/inbox?lang=en");
  const phone = `+96171${String(Date.now()).slice(-6)}`;
  await page.getByLabel("Customer phone").fill(phone);
  await page.getByLabel("WhatsApp profile name").fill("E2E WhatsApp");
  await page.getByTestId("sim-input").fill("badde 7jez tanzif bukra");
  await page.keyboard.press("Enter");
  await page.waitForURL(/\/dashboard\/inbox\/[0-9a-f-]{36}/);
  await expect(page.locator("section").getByText(/Ayya bi nesbak/)).toBeVisible();
  await expect(page.locator("section").getByText(/AI actions: check_availability/)).toBeVisible();

  await page.locator("details").last().evaluate((d) => ((d as HTMLDetailsElement).open = true));
  await page.getByTestId("sim-input").fill("1");
  await page.keyboard.press("Enter");
  await expect(page.locator("section").getByText(/7ajaztellak/)).toBeVisible();

  await page.getByRole("button", { name: "Take over" }).click();
  await expect(page.locator("section").getByText(/Staff took over/)).toBeVisible();
  await page.getByPlaceholder("Type a reply…").fill("Hi, this is the clinic — see you tomorrow!");
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await expect(page.locator("section").getByText("Hi, this is the clinic — see you tomorrow!")).toBeVisible();
  await page.getByRole("button", { name: "Hand back to AI" }).click();
  await expect(page.locator("section").getByText(/AI receptionist resumed/)).toBeVisible();
});

test("web chat widget page answers in the visitor's language", async ({ page }) => {
  await page.goto("/chat/demo-dental?lang=fr");
  await page.getByTestId("chat-input").fill("Combien coûte un plombage ?");
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("chat-messages")).toContainText("$80");
});
