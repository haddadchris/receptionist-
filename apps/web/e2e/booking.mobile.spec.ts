import { expect, test } from "@playwright/test";

test.describe("public booking page (mobile, Arabic)", () => {
  test.use({ locale: "ar-LB" });

  test("books, opens the manage link and cancels", async ({ page }) => {
    await page.goto("/b/demo-dental");
    await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
    await expect(page.getByRole("heading", { name: "Demo Dental Clinic" })).toBeVisible();

    await page.getByText("فحص واستشارة").click();
    await page.getByText("ما في فرق").click();
    const firstSlot = page.locator("button.ltr-nums.h-11").first();
    await expect(firstSlot).toBeVisible();
    // Prefer a later day so the appointment stays cancellable online (12h notice).
    const days = page.locator("button.w-14:not([disabled])");
    await days.nth(Math.min(3, (await days.count()) - 1)).click();
    await page.locator("button.ltr-nums.h-11").first().click();

    await page.fill("#bk-name", "E2E Test Patient");
    await page.fill("#bk-phone", `70 ${String(Date.now()).slice(-6)}`);
    await page.getByRole("button", { name: "أكّد الحجز" }).click();
    await expect(page.getByTestId("booking-success")).toBeVisible();

    const manage = await page.getByRole("link", { name: "غيّر أو ألغي" }).getAttribute("href");
    expect(manage).toContain("/manage/");
    await page.goto(manage!);
    await expect(page.getByText("مؤكّد")).toBeVisible();
    await page.getByRole("button", { name: "ألغي الموعد" }).click();
    await page.getByRole("button", { name: "إيه، ألغيه" }).click();
    await expect(page.getByText("ملغى")).toBeVisible();
  });

  test("tampered manage links are rejected", async ({ page }) => {
    await page.goto("/b/demo-dental/manage/abc.def");
    await expect(page.getByText("هالرابط مش صالح أو منتهي.")).toBeVisible();
  });
});
