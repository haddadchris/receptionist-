"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Globe } from "lucide-react";
import { useI18n } from "@/i18n/client";
import { dictionaries, type Locale } from "@/i18n";
import { cn } from "@/lib/utils";

export function LanguageSwitcher({ allowed, className }: { allowed?: Locale[]; className?: string }) {
  const { locale } = useI18n();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const langs = allowed?.length ? allowed : (["ar", "en", "fr"] as Locale[]);
  if (langs.length < 2) return null;
  return (
    <div className={cn("inline-flex items-center gap-1 rounded-full border bg-background p-0.5 text-xs", className)}>
      <Globe className="ms-1.5 size-3.5 text-muted-foreground" />
      {langs.map((l) => (
        <button
          key={l}
          type="button"
          onClick={() => {
            const sp = new URLSearchParams(params.toString());
            sp.set("lang", l);
            router.replace(`${pathname}?${sp.toString()}`);
            router.refresh();
          }}
          className={cn(
            "rounded-full px-2 py-1 font-medium transition-colors",
            l === locale ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground",
          )}
          aria-pressed={l === locale}
        >
          {dictionaries[l].meta.name}
        </button>
      ))}
    </div>
  );
}
