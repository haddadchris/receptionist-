import Link from "next/link";
import { Suspense } from "react";
import { Logo } from "@/components/layout/logo";
import { LanguageSwitcher } from "@/components/layout/language-switcher";
import { Button } from "@/components/ui/button";
import { getT } from "@/i18n/server";

export default async function Home() {
  const { t } = await getT();
  return (
    <main className="min-h-dvh">
      <header className="mx-auto flex max-w-6xl items-center justify-between p-4">
        <Logo />
        <div className="flex items-center gap-2">
          <Suspense>
            <LanguageSwitcher />
          </Suspense>
          <Button asChild variant="ghost" size="sm">
            <Link href="/login">{t("auth.signIn")}</Link>
          </Button>
        </div>
      </header>
      <section className="mx-auto max-w-3xl px-4 py-20 text-center">
        <h1 className="text-4xl font-bold tracking-tight">Fekerte</h1>
        <p className="mt-4 text-lg text-muted-foreground">{t("auth.signupSubtitle")}</p>
        <div className="mt-8 flex justify-center gap-3">
          <Button asChild size="lg">
            <Link href="/signup">{t("auth.signUp")}</Link>
          </Button>
          <Button asChild size="lg" variant="outline">
            <Link href="/b/demo-dental">Demo Dental Clinic</Link>
          </Button>
        </div>
      </section>
    </main>
  );
}
