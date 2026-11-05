import { expect, test } from "@playwright/test";
import { DEMO_OWNER, login } from "./helpers";

test("browser call simulator: book an appointment by voice turns (Lebanese Arabic)", async ({ page }) => {
  await login(page, DEMO_OWNER.email, DEMO_OWNER.password, "ar");
  await page.goto("/dashboard/voice/test?lang=ar");
  await page.getByPlaceholder("+961 3 123 456").fill(`+96176${String(Date.now()).slice(-6)}`);
  await page.getByTestId("start-call").click();
  const transcript = page.getByTestId("call-transcript");
  await expect(transcript).toContainText("أهلا وسهلا");
  const say = async (text: string, expectText: RegExp) => {
    await page.getByTestId("call-type").fill(text);
    await page.keyboard.press("Enter");
    await expect(transcript).toContainText(expectText);
  };
  await say("بدي موعد فحص بكرا بعد الضهر", /أيّا بيناسبك/);
  await say("الأول", /الاسم الكامل/);
  await say("اسمي ريتا خوري", /بأكّدلك/);
  await say("إيه", /حجزتلك/);
  await page.getByRole("button", { name: "سكّر المكالمة" }).click();
  await page.getByRole("link", { name: /سجلّ المكالمة/ }).click();
  await expect(page.getByText("انحجز").first()).toBeVisible();
});
