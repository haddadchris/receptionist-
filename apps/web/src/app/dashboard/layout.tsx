import { Suspense } from "react";
import { Eye } from "lucide-react";
import { requireBusiness } from "@/lib/auth/current";
import { getT } from "@/i18n/server";
import { Logo } from "@/components/layout/logo";
import { MobileNav, SidebarNav, type NavFeature } from "@/components/layout/dashboard-nav";
import { UserMenu } from "@/components/layout/user-menu";
import { LanguageSwitcher } from "@/components/layout/language-switcher";
import { bookingUrl } from "@fekerte/core/booking/tokens";
import { enabledNavFeatures, unreadCount } from "@/lib/dashboard-data";
import { stopImpersonationAction } from "@/app/admin/actions";

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const ctx = await requireBusiness({ allowIncompleteOnboarding: false });
  const { t } = await getT();
  const features: NavFeature[] = enabledNavFeatures(ctx.business);
  const unread = await unreadCount(ctx.business.id);
  const link = bookingUrl(ctx.business.slug);
  return (
    <div className="min-h-dvh md:grid md:grid-cols-[240px_1fr]">
      <aside className="sticky top-0 hidden h-dvh flex-col gap-4 border-e bg-card p-3 md:flex">
        <div className="px-2 pt-1">
          <Logo href="/dashboard" />
          <p className="mt-2 truncate text-xs text-muted-foreground">{ctx.business.name}</p>
        </div>
        <div className="flex-1 overflow-y-auto">
          <SidebarNav features={features} bookingUrl={link} unread={unread} />
        </div>
        <Suspense>
          <LanguageSwitcher className="self-start" />
        </Suspense>
      </aside>
      <div className="flex min-w-0 flex-col">
        {ctx.readOnly ? (
          <div className="flex items-center justify-center gap-3 bg-warning/20 px-4 py-2 text-sm">
            <Eye className="size-4" /> {t("common.readOnly")} — <strong>{ctx.business.name}</strong>
            <form action={stopImpersonationAction}>
              <button className="underline" type="submit">
                {t("common.exitImpersonation")}
              </button>
            </form>
          </div>
        ) : null}
        <header className="sticky top-0 z-30 flex h-14 items-center justify-between gap-2 border-b bg-background/95 px-4 backdrop-blur">
          <div className="md:hidden">
            <Logo href="/dashboard" />
          </div>
          <div className="hidden truncate text-sm font-medium md:block">{ctx.business.name}</div>
          <div className="flex items-center gap-2">
            <Suspense>
              <LanguageSwitcher className="md:hidden" />
            </Suspense>
            <UserMenu
              user={{ name: ctx.user.name, email: ctx.user.email }}
              businesses={ctx.memberships}
              currentBusinessId={ctx.business.id}
              isSuperAdmin={ctx.user.isSuperAdmin}
            />
          </div>
        </header>
        <main className="flex-1 px-4 pt-4 pb-24 md:px-6 md:pb-8">{children}</main>
      </div>
      <MobileNav features={features} bookingUrl={link} unread={unread} />
    </div>
  );
}
