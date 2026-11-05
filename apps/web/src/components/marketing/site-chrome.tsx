import Link from "next/link";
import { Suspense } from "react";
import { Menu } from "lucide-react";
import { Logo } from "@/components/layout/logo";
import { LanguageSwitcher } from "@/components/layout/language-switcher";
import { Button } from "@/components/ui/button";
import type { TFn } from "@/i18n";

export function SiteHeader({ t }: { t: TFn }) {
  const links = [
    { href: "/#how", label: t("marketing.nav.how") },
    { href: "/#pricing", label: t("marketing.nav.pricing") },
    { href: "/#faq", label: t("marketing.nav.faq") },
    { href: "/demo", label: t("marketing.nav.demo") },
  ];
  return (
    <header className="sticky top-0 z-40 border-b bg-background/90 backdrop-blur">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-3 px-4">
        <Logo />
        <nav className="hidden items-center gap-6 text-sm md:flex">
          {links.map((l) => (
            <Link key={l.href} href={l.href} className="text-muted-foreground hover:text-foreground">
              {l.label}
            </Link>
          ))}
        </nav>
        <div className="flex items-center gap-2">
          <Suspense>
            <LanguageSwitcher className="hidden sm:inline-flex" />
          </Suspense>
          <Button asChild variant="ghost" size="sm" className="hidden sm:inline-flex">
            <Link href="/login">{t("marketing.nav.login")}</Link>
          </Button>
          <Button asChild size="sm">
            <Link href="/#demo">{t("marketing.nav.bookDemo")}</Link>
          </Button>
          <details className="relative md:hidden">
            <summary className="grid size-9 cursor-pointer list-none place-items-center rounded-md border" aria-label="Menu">
              <Menu className="size-4" />
            </summary>
            <div className="absolute end-0 top-11 grid w-56 gap-1 rounded-xl border bg-popover p-2 shadow-lg">
              {links.map((l) => (
                <Link key={l.href} href={l.href} className="rounded-md px-3 py-2 text-sm hover:bg-accent">
                  {l.label}
                </Link>
              ))}
              <Link href="/login" className="rounded-md px-3 py-2 text-sm hover:bg-accent">
                {t("marketing.nav.login")}
              </Link>
              <div className="px-2 py-1">
                <Suspense>
                  <LanguageSwitcher />
                </Suspense>
              </div>
            </div>
          </details>
        </div>
      </div>
    </header>
  );
}

export function SiteFooter({ t }: { t: TFn }) {
  return (
    <footer className="border-t bg-muted/40">
      <div className="mx-auto grid max-w-6xl gap-4 px-4 py-8 text-sm sm:grid-cols-[1fr_auto] sm:items-center">
        <div className="grid gap-2">
          <Logo />
          <p className="text-muted-foreground">{t("marketing.footer.tagline")}</p>
        </div>
        <div className="flex flex-wrap gap-x-5 gap-y-2 text-muted-foreground">
          <Link href="/demo" className="hover:text-foreground">
            {t("marketing.nav.demo")}
          </Link>
          <Link href="/#pricing" className="hover:text-foreground">
            {t("marketing.nav.pricing")}
          </Link>
          <Link href="/login" className="hover:text-foreground">
            {t("marketing.nav.login")}
          </Link>
          <span>
            © {new Date().getFullYear()} Fekerte · {t("marketing.footer.madeIn")}
          </span>
        </div>
      </div>
    </footer>
  );
}
