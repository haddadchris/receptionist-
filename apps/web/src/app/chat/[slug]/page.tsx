import { notFound, redirect } from "next/navigation";
import { getBusinessBySlug } from "@fekerte/core/business/public";
import { checkAiAllowed } from "@fekerte/core/billing/limits";
import { getT } from "@/i18n/server";
import { ChatWindow } from "@/components/chat/chat-window";
import { brandStyle } from "@/components/booking/booking-header";

export const metadata = { title: "Chat", robots: { index: false } };

/** Standalone chat page — loaded inside the widget iframe (?embed=1) or opened directly. */
export default async function ChatPage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<{ embed?: string }> }) {
  const { slug } = await params;
  const { embed } = await searchParams;
  const business = await getBusinessBySlug(slug);
  if (!business) notFound();
  const { t, locale } = await getT();
  if (!business.languages.includes(locale)) redirect(`/chat/${business.slug}?lang=${business.defaultLanguage}${embed ? "&embed=1" : ""}`);
  const check = await checkAiAllowed(business, "webChat");
  const blocked = check.ok ? null : check.reason;
  return (
    <div style={brandStyle(business.branding.primaryColor)} className="flex h-dvh flex-col">
      <header className="flex items-center justify-between bg-primary px-4 py-3 text-primary-foreground">
        <div>
          <div className="text-sm font-semibold">{business.name}</div>
          <div className="text-xs opacity-80">{t("chat.title")}</div>
        </div>
        {!embed ? (
          <a href={`/b/${business.slug}`} className="rounded-full bg-white/15 px-3 py-1 text-xs">
            {t("nav.bookingPage")}
          </a>
        ) : null}
      </header>
      {blocked ? (
        <p className="m-4 rounded-lg bg-muted p-4 text-sm">{t("chat.unavailable")}</p>
      ) : (
        <ChatWindow slug={business.slug} businessName={business.name} className="flex-1" />
      )}
    </div>
  );
}
