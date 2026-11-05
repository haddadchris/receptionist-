import Link from "next/link";
import type { Metadata } from "next";
import { BarChart3, BellRing, Bot, CalendarCheck2, Check, Clock4, MessageCircle, PhoneCall, PhoneMissed, Star, UserX } from "lucide-react";
import { withSystem } from "@fekerte/core/db/tenant";
import { listPlans } from "@fekerte/core/billing/plans";
import { TIER_FEATURES } from "@fekerte/core/billing/features";
import { VERTICALS } from "@fekerte/core/business/presets";
import { pickLocalized } from "@fekerte/core/lib/i18n";
import { getT } from "@/i18n/server";
import type { TKey } from "@/i18n";
import { Button } from "@/components/ui/button";
import { SiteFooter, SiteHeader } from "@/components/marketing/site-chrome";
import { RoiCalculator } from "@/components/marketing/roi-calculator";
import { DemoForm } from "@/components/marketing/demo-form";
import { fmtPrice } from "@/lib/format";
import { cn } from "@/lib/utils";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getT();
  return { title: { absolute: t("marketing.metaTitle") }, description: t("marketing.metaDescription") };
}

// Pricing comes from the database (editable in the admin panel).
export const dynamic = "force-dynamic";

function Section({ id, className, children }: { id?: string; className?: string; children: React.ReactNode }) {
  return (
    <section id={id} className={cn("mx-auto max-w-6xl scroll-mt-20 px-4 py-14 sm:py-20", className)}>
      {children}
    </section>
  );
}

function Bubble({ from, children }: { from: "patient" | "ai"; children: React.ReactNode }) {
  return (
    <div className={cn("max-w-[85%] rounded-2xl px-3 py-2 text-sm shadow-xs", from === "patient" ? "justify-self-end rounded-ee-sm bg-[#dcf8c6] text-[#111]" : "justify-self-start rounded-es-sm bg-white text-[#111]")}>
      {children}
    </div>
  );
}

export default async function Home() {
  const { t, locale, dict } = await getT();
  const plans = await withSystem((tx) => listPlans(tx));
  const premium = plans.find((p) => p.tier === "premium");
  const tagline: Record<string, TKey> = { basic: "marketing.pricing.basicTagline", standard: "marketing.pricing.standardTagline", premium: "marketing.pricing.premiumTagline" };

  return (
    <div className="min-h-dvh bg-background">
      <SiteHeader t={t} />
      <main>
        {/* Hero */}
        <div className="bg-gradient-to-b from-primary/10 to-background">
          <Section className="grid items-center gap-10 py-12 md:grid-cols-[1.15fr_1fr] md:py-20">
            <div className="grid gap-5">
              <p className="text-sm font-medium text-primary">{t("marketing.hero.eyebrow")}</p>
              <h1 className="text-4xl leading-tight font-bold tracking-tight text-balance sm:text-5xl">{t("marketing.hero.title")}</h1>
              <p className="text-lg text-muted-foreground text-pretty">{t("marketing.hero.subtitle")}</p>
              <div className="flex flex-wrap gap-3">
                <Button asChild size="lg">
                  <Link href="/demo">{t("marketing.hero.ctaDemo")}</Link>
                </Button>
                <Button asChild size="lg" variant="outline">
                  <Link href="#demo">{t("marketing.hero.ctaBook")}</Link>
                </Button>
              </div>
              <p className="text-sm text-muted-foreground">{t("marketing.hero.note")}</p>
            </div>
            <figure className="mx-auto w-full max-w-sm rounded-[2rem] border-8 border-foreground/90 bg-[#efeae2] shadow-xl" aria-label={t("marketing.heroChat.label")}>
              <div className="flex items-center gap-2 rounded-t-[1.4rem] bg-[#075e54] px-4 py-3 text-white">
                <span className="grid size-8 place-items-center rounded-full bg-white/20 text-xs font-semibold">DC</span>
                <div className="text-sm leading-tight">
                  <p className="font-semibold">Demo Dental Clinic</p>
                  <p className="text-xs opacity-80">WhatsApp</p>
                </div>
              </div>
              <div className="grid gap-2 p-3 pb-5" dir={locale === "ar" ? "rtl" : "ltr"}>
                <Bubble from="patient">{t("marketing.heroChat.patient1")}</Bubble>
                <Bubble from="ai">{t("marketing.heroChat.ai1")}</Bubble>
                <Bubble from="patient">{t("marketing.heroChat.patient2")}</Bubble>
                <Bubble from="ai">{t("marketing.heroChat.ai2")}</Bubble>
              </div>
              <figcaption className="pb-3 text-center text-[11px] text-[#555]">{t("marketing.heroChat.label")}</figcaption>
            </figure>
          </Section>
        </div>

        {/* Problem + ROI */}
        <Section>
          <h2 className="max-w-2xl text-3xl font-bold tracking-tight text-balance">{t("marketing.problem.title")}</h2>
          <div className="mt-8 grid gap-4 md:grid-cols-3">
            {(
              [
                ["calls", PhoneMissed],
                ["whatsapp", Clock4],
                ["noShows", UserX],
              ] as const
            ).map(([k, Icon]) => (
              <div key={k} className="rounded-2xl border bg-card p-5">
                <Icon className="size-6 text-destructive" />
                <h3 className="mt-3 font-semibold">{t(`marketing.problem.${k}.title`)}</h3>
                <p className="mt-1 text-sm text-muted-foreground">{t(`marketing.problem.${k}.text`)}</p>
              </div>
            ))}
          </div>
          <div className="mt-12 grid gap-2">
            <h3 className="text-2xl font-bold">{t("marketing.roi.title")}</h3>
            <p className="text-muted-foreground">{t("marketing.roi.subtitle")}</p>
            <div className="mt-4">
              <RoiCalculator premiumMonthlyCents={premium?.monthlyFeeCents ?? 0} />
            </div>
          </div>
        </Section>

        {/* How it works */}
        <div className="bg-muted/40">
          <Section id="how">
            <h2 className="text-3xl font-bold tracking-tight">{t("marketing.how.title")}</h2>
            <ol className="mt-8 grid gap-4 md:grid-cols-3">
              {(["step1", "step2", "step3"] as const).map((k, i) => (
                <li key={k} className="rounded-2xl border bg-card p-5">
                  <span className="grid size-8 place-items-center rounded-full bg-primary text-sm font-bold text-primary-foreground">{i + 1}</span>
                  <h3 className="mt-3 font-semibold">{t(`marketing.how.${k}.title`)}</h3>
                  <p className="mt-1 text-sm text-muted-foreground">{t(`marketing.how.${k}.text`)}</p>
                </li>
              ))}
            </ol>
          </Section>
        </div>

        {/* Features */}
        <Section>
          <h2 className="text-3xl font-bold tracking-tight">{t("marketing.features.title")}</h2>
          <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {(
              [
                ["booking", CalendarCheck2],
                ["whatsapp", MessageCircle],
                ["voice", PhoneCall],
                ["reminders", BellRing],
                ["reviews", Star],
                ["analytics", BarChart3],
              ] as const
            ).map(([k, Icon]) => (
              <div key={k} className="rounded-2xl border bg-card p-5">
                <Icon className="size-6 text-primary" />
                <h3 className="mt-3 font-semibold">{t(`marketing.features.${k}.title`)}</h3>
                <p className="mt-1 text-sm text-muted-foreground">{t(`marketing.features.${k}.text`)}</p>
              </div>
            ))}
          </div>
        </Section>

        {/* Pricing */}
        <div className="bg-muted/40">
          <Section id="pricing">
            <h2 className="text-3xl font-bold tracking-tight">{t("marketing.pricing.title")}</h2>
            <p className="mt-2 text-muted-foreground">{t("marketing.pricing.subtitle")}</p>
            <div className="mt-8 grid gap-4 lg:grid-cols-3">
              {plans.map((p) => {
                const popular = p.tier === "standard";
                return (
                  <div key={p.tier} className={cn("relative flex flex-col gap-4 rounded-2xl border bg-card p-6", popular && "border-primary shadow-lg ring-1 ring-primary")} data-testid={`pricing-${p.tier}`}>
                    {popular ? <span className="absolute -top-3 start-6 rounded-full bg-primary px-3 py-0.5 text-xs font-medium text-primary-foreground">{t("marketing.pricing.popular")}</span> : null}
                    <div>
                      {/* Admin-editable names look like "Standard — AI WhatsApp receptionist"; tier name + localized tagline reads better. */}
                      <h3 className="text-lg font-semibold">{p.name.split(" — ")[0]}</h3>
                      <p className="text-sm text-muted-foreground">{t(tagline[p.tier]!)}</p>
                    </div>
                    <p>
                      <span className="text-4xl font-bold">{fmtPrice(p.monthlyFeeCents)}</span>
                      <span className="text-muted-foreground">{t("marketing.pricing.perMonth")}</span>
                    </p>
                    {p.setupFeeCents ? <p className="-mt-3 text-sm text-muted-foreground">{t("marketing.pricing.setup", { amount: fmtPrice(p.setupFeeCents) })}</p> : null}
                    <ul className="grid gap-2 text-sm">
                      <li className="flex gap-2">
                        <Check className="mt-0.5 size-4 shrink-0 text-success" /> {t("billing.onlineBooking")}
                      </li>
                      {TIER_FEATURES[p.tier].map((f) => (
                        <li key={f} className="flex gap-2">
                          <Check className="mt-0.5 size-4 shrink-0 text-success" /> {t(`billing.features.${f}` as TKey)}
                        </li>
                      ))}
                      {p.includedAiMessages ? <li className="ps-6 text-xs text-muted-foreground">{t("billing.aiIncluded", { n: p.includedAiMessages })}</li> : null}
                      {p.includedVoiceMinutes ? <li className="ps-6 text-xs text-muted-foreground">{t("billing.voiceIncluded", { n: p.includedVoiceMinutes })}</li> : null}
                    </ul>
                    <Button asChild className="mt-auto" variant={popular ? "default" : "outline"}>
                      <Link href={`/?plan=${p.tier}#demo`}>{t("marketing.pricing.choose")}</Link>
                    </Button>
                  </div>
                );
              })}
            </div>
          </Section>
        </div>

        {/* FAQ */}
        <Section id="faq" className="max-w-3xl">
          <h2 className="text-3xl font-bold tracking-tight">{t("marketing.faq.title")}</h2>
          <div className="mt-6 divide-y rounded-2xl border bg-card">
            {dict.marketing.faq.items.map((item) => (
              <details key={item.q} className="group p-5">
                <summary className="flex cursor-pointer list-none items-center justify-between gap-4 font-medium">
                  {item.q}
                  <span className="text-xl text-muted-foreground transition-transform group-open:rotate-45">+</span>
                </summary>
                <p className="mt-3 text-sm text-muted-foreground">{item.a}</p>
              </details>
            ))}
          </div>
        </Section>

        {/* Book a demo */}
        <div className="bg-gradient-to-b from-background to-primary/10">
          <Section id="demo" className="grid gap-8 md:grid-cols-[1fr_1.4fr]">
            <div className="grid content-start gap-3">
              <Bot className="size-8 text-primary" />
              <h2 className="text-3xl font-bold tracking-tight">{t("marketing.demoForm.title")}</h2>
              <p className="text-muted-foreground">{t("marketing.demoForm.subtitle")}</p>
              <Button asChild variant="outline" className="justify-self-start">
                <Link href="/demo">{t("marketing.hero.ctaDemo")}</Link>
              </Button>
            </div>
            <DemoForm verticals={VERTICALS.map((v) => ({ id: v.id, label: pickLocalized(v.label, locale) }))} plans={plans.map((p) => ({ tier: p.tier, name: p.name }))} />
          </Section>
        </div>
      </main>
      <SiteFooter t={t} />
    </div>
  );
}
