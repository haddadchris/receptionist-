import { redirect } from "next/navigation";
import { Suspense } from "react";
import { withSystem, withTenant } from "@fekerte/core/db/tenant";
import { getUserMemberships } from "@fekerte/core/auth/users";
import { getBusiness } from "@fekerte/core/availability/loader";
import { config } from "@fekerte/core/config";
import type { Vertical } from "@fekerte/core/business/presets";
import { requireUser } from "@/lib/auth/current";
import { getT } from "@/i18n/server";
import { Logo } from "@/components/layout/logo";
import { LanguageSwitcher } from "@/components/layout/language-switcher";
import { OnboardingWizard } from "@/components/onboarding/wizard";

export const metadata = { title: "Get started" };

export default async function OnboardingPage() {
  const user = await requireUser();
  const { t } = await getT();
  const memberships = await withSystem((tx) => getUserMemberships(tx, user.id));
  if (memberships.some((m) => m.onboarded) && !memberships.some((m) => m.role === "owner" && !m.onboarded)) redirect("/dashboard");
  const pending = memberships.find((m) => m.role === "owner" && !m.onboarded);
  const biz = pending ? await withTenant(pending.businessId, (tx) => getBusiness(tx, pending.businessId)) : null;

  return (
    <main className="min-h-dvh bg-gradient-to-b from-primary/5 to-background px-4 pb-16">
      <header className="mx-auto flex max-w-2xl items-center justify-between py-4">
        <Logo />
        <Suspense>
          <LanguageSwitcher />
        </Suspense>
      </header>
      <h1 className="mx-auto mb-6 max-w-2xl text-2xl font-semibold">{t("onboarding.title")}</h1>
      <OnboardingWizard
        appUrl={config.appUrl}
        userName={user.name ?? t("onboarding.me")}
        initial={{
          step: biz ? 1 : 0,
          businessId: biz?.id ?? null,
          name: biz?.name ?? "",
          vertical: ((biz?.vertical as Vertical) ?? "dental") as Vertical,
          phone: biz?.phone ?? "",
          city: biz?.city ?? "",
          slug: biz?.slug ?? null,
        }}
      />
    </main>
  );
}
