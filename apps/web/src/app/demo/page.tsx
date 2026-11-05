import Link from "next/link";
import type { Metadata } from "next";
import { MessageCircle, PhoneCall } from "lucide-react";
import { config } from "@fekerte/core/config";
import { getBusinessBySlug } from "@fekerte/core/business/public";
import { getT } from "@/i18n/server";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ChatWindow } from "@/components/chat/chat-window";
import { CallSimulator } from "@/components/voice/call-simulator";
import { SiteFooter, SiteHeader } from "@/components/marketing/site-chrome";
import { demoVoiceTokenAction } from "@/app/marketing-actions";
import { DEMO_SLUG } from "@/lib/demo";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getT();
  return { title: t("marketing.demoPage.title"), description: t("marketing.demoPage.subtitle") };
}

export const dynamic = "force-dynamic";

async function voiceReachable(): Promise<boolean> {
  try {
    const res = await fetch(`${config.voiceUrl}/health`, { cache: "no-store", signal: AbortSignal.timeout(1500) });
    return res.ok;
  } catch {
    return false;
  }
}

/** Public live demo: chat with / call the demo clinic's AI receptionist (rate-limited, demo data only). */
export default async function DemoPage() {
  const { t, locale } = await getT();
  const business = await getBusinessBySlug(DEMO_SLUG);
  const voiceOk = await voiceReachable();
  const publicVoiceUrl = process.env.NEXT_PUBLIC_VOICE_URL ?? config.voiceUrl;
  return (
    <div className="min-h-dvh bg-muted/30">
      <SiteHeader t={t} />
      <main className="mx-auto grid max-w-6xl gap-6 px-4 py-10">
        <div className="grid gap-2">
          <h1 className="text-3xl font-bold tracking-tight">{t("marketing.demoPage.title")}</h1>
          <p className="text-muted-foreground">{t("marketing.demoPage.subtitle")}</p>
          <p className="text-xs text-muted-foreground">{t("marketing.demoPage.limits")}</p>
        </div>
        {!business ? (
          <p className="rounded-lg bg-warning/15 p-3 text-sm" dir="ltr">
            Demo business “{DEMO_SLUG}” not found — run <code>pnpm db:seed</code>.
          </p>
        ) : (
          <div className="grid gap-6 lg:grid-cols-2 [&>*]:min-w-0">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <MessageCircle className="size-5 text-primary" /> {t("marketing.demoPage.chatTitle")}
                </CardTitle>
                <CardDescription>{t("marketing.demoPage.chatHint")}</CardDescription>
              </CardHeader>
              <CardContent>
                <ChatWindow
                  slug={business.slug}
                  businessName={business.name}
                  storageKey={`fk-demo-chat-${locale}`}
                  className="h-[520px]"
                  suggestions={locale === "ar" ? ["قديش التنظيف؟", "بدّي احجز فحص بكرا"] : locale === "fr" ? ["Combien coûte un détartrage ?", "Je voudrais un rendez-vous demain"] : ["How much is a cleaning?", "badde 7jez tanzif bukra"]}
                />
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <PhoneCall className="size-5 text-primary" /> {t("marketing.demoPage.callTitle")}
                </CardTitle>
                <CardDescription>{t("marketing.demoPage.callHint")}</CardDescription>
              </CardHeader>
              <CardContent>
                {voiceOk ? (
                  <CallSimulator voiceUrl={publicVoiceUrl} defaultLanguage={locale} audioAvailable={process.env.DEMO_ALLOW_AUDIO === "true"} tokenAction={demoVoiceTokenAction} showCallerId={false} />
                ) : (
                  <p className="rounded-lg bg-muted p-3 text-sm text-muted-foreground">—</p>
                )}
              </CardContent>
            </Card>
          </div>
        )}
        <Link href={`/b/${DEMO_SLUG}`} className="text-sm text-primary underline">
          {t("marketing.demoPage.bookingPage")}
        </Link>
      </main>
      <SiteFooter t={t} />
    </div>
  );
}
