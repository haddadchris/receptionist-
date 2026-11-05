import { MapPin, Phone } from "lucide-react";
import { Suspense } from "react";
import { LanguageSwitcher } from "@/components/layout/language-switcher";
import type { Locale } from "@/i18n";
import type { Business } from "@fekerte/core/db/schema";
import { initials } from "@/lib/utils";

export function BookingHeader({ business, locale, callLabel, directionsLabel }: { business: Business; locale: Locale; callLabel: string; directionsLabel: string }) {
  const tagline = business.branding.tagline?.[locale] ?? business.branding.tagline?.en;
  return (
    <header className="bg-primary text-primary-foreground">
      <div className="mx-auto max-w-xl px-4 pt-4 pb-6">
        <div className="flex justify-end">
          <Suspense>
            <LanguageSwitcher allowed={business.languages} className="border-white/30 bg-white/10 text-white [&_button]:text-white/80" />
          </Suspense>
        </div>
        <div className="mt-3 flex items-center gap-3">
          {business.branding.logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={business.branding.logoUrl} alt="" className="size-14 rounded-2xl bg-white object-cover" />
          ) : (
            <span className="grid size-14 place-items-center rounded-2xl bg-white/15 text-lg font-bold">{initials(business.name)}</span>
          )}
          <div className="min-w-0">
            <h1 className="truncate text-xl font-semibold">{business.name}</h1>
            {tagline ? <p className="text-sm opacity-90">{tagline}</p> : null}
            {business.address || business.city ? (
              <p className="mt-0.5 flex items-center gap-1 text-xs opacity-80">
                <MapPin className="size-3" /> {[business.address, business.city].filter(Boolean).join(", ")}
              </p>
            ) : null}
          </div>
        </div>
        <div className="mt-4 flex gap-2">
          {business.phone ? (
            <a href={`tel:${business.phone}`} className="inline-flex items-center gap-1.5 rounded-full bg-white/15 px-3 py-1.5 text-xs font-medium hover:bg-white/25">
              <Phone className="size-3.5" /> {callLabel}
            </a>
          ) : null}
          {business.mapsUrl ? (
            <a href={business.mapsUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 rounded-full bg-white/15 px-3 py-1.5 text-xs font-medium hover:bg-white/25">
              <MapPin className="size-3.5" /> {directionsLabel}
            </a>
          ) : null}
          {business.whatsappNumber ? (
            <a
              href={`https://wa.me/${business.whatsappNumber.replace("+", "")}`}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1.5 rounded-full bg-white/15 px-3 py-1.5 text-xs font-medium hover:bg-white/25"
            >
              WhatsApp
            </a>
          ) : null}
        </div>
      </div>
    </header>
  );
}

/** Inline style that re-themes the page with the business's brand colour. */
export function brandStyle(color: string | null | undefined): React.CSSProperties | undefined {
  if (!color || !/^#[0-9a-fA-F]{6}$/.test(color)) return undefined;
  return { ["--primary" as string]: color, ["--ring" as string]: color };
}
