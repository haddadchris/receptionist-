import { expect, test } from "@playwright/test";
import { DateTime } from "luxon";
import { DEMO_OWNER, login } from "./helpers";

test.describe("owner dashboard", () => {
  test("creates an appointment from the calendar and manages it", async ({ page }) => {
    await login(page, DEMO_OWNER.email, DEMO_OWNER.password);
    // Next Monday — Dr. Rami works, slots are open.
    const monday = DateTime.now().setZone("Asia/Beirut").plus({ weeks: 1 }).startOf("week").plus({ weeks: 1 }).toISODate()!;
    await page.goto(`/dashboard/calendar?date=${monday}&view=day`);
    await expect(page.getByText("Dr. Rami Khoury").first()).toBeVisible();

    await page.getByRole("button", { name: "New appointment" }).click();
    const dialog = page.getByRole("dialog");
    const stamp = String(Date.now()).slice(-6);
    const phone = `+96171${stamp}`;
    const name = `E2E Customer ${stamp}`;
    await dialog.getByPlaceholder("03 123 456").fill(phone);
    await dialog.locator("input").nth(1).fill(name);
    await dialog.locator("button.ltr-nums").first().click();
    await dialog.getByRole("button", { name: "Book appointment" }).click();
    await expect(page.getByText("Appointment booked")).toBeVisible();

    await page.goto(`/dashboard/appointments?q=${encodeURIComponent(name)}`);
    const row = page.getByRole("button", { name: new RegExp(name) }).first();
    await expect(row).toBeVisible();
    await row.click();
    await page.getByRole("dialog").getByRole("button", { name: "Cancel appointment" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Cancel appointment" }).click();
    await expect(page.getByText("Appointment cancelled")).toBeVisible();
  });

  test("dashboard renders right-to-left in Arabic", async ({ page }) => {
    await login(page, DEMO_OWNER.email, DEMO_OWNER.password, "ar");
    await page.goto("/dashboard?lang=ar");
    await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
    await expect(page.getByRole("link", { name: "الروزنامة" }).first()).toBeVisible();
  });

  test("other tenants' customers are not reachable by URL", async ({ page }) => {
    await login(page, DEMO_OWNER.email, DEMO_OWNER.password);
    const res = await page.goto("/dashboard/customers/00000000-0000-0000-0000-000000000000");
    expect(res?.status()).toBe(404);
  });
});
