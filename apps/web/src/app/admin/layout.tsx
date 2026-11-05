import Link from "next/link";
import { Suspense } from "react";
import { Shield } from "lucide-react";
import { requireSuperAdmin } from "@/lib/auth/current";
import { getT } from "@/i18n/server";
import { Logo } from "@/components/layout/logo";
import { LanguageSwitcher } from "@/components/layout/language-switcher";
import { AdminNav } from "@/components/admin/admin-nav";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const admin = await requireSuperAdmin();
  const { t } = await getT();
  return (
    <div className="min-h-dvh bg-muted/30">
      <header className="sticky top-0 z-30 border-b bg-background/95 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-7xl items-center justify-between gap-3 px-4">
          <div className="flex items-center gap-3">
            <Logo href="/admin" />
            <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
              <Shield className="size-3" /> {t("admin.title")}
            </span>
          </div>
          <div className="flex items-center gap-3 text-sm">
            <Suspense>
              <LanguageSwitcher />
            </Suspense>
            <span className="hidden text-muted-foreground sm:inline" dir="ltr">
              {admin.email}
            </span>
            <Link href="/dashboard" className="text-primary hover:underline">
              Dashboard
            </Link>
            <form action="/auth/logout" method="post">
              <button className="text-muted-foreground hover:text-foreground">{t("common.signOut")}</button>
            </form>
          </div>
        </div>
        <div className="mx-auto max-w-7xl px-4">
          <AdminNav />
        </div>
      </header>
      <main className="mx-auto max-w-7xl p-4">{children}</main>
    </div>
  );
}
