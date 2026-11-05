import type { Metadata, Viewport } from "next";
import { Inter, IBM_Plex_Sans_Arabic } from "next/font/google";
import { Toaster } from "sonner";
import { getLocale } from "@/i18n/server";
import { dirOf } from "@/i18n";
import { I18nProvider } from "@/i18n/client";
import "./globals.css";

const latin = Inter({ subsets: ["latin"], variable: "--font-latin", display: "swap" });
const arabic = IBM_Plex_Sans_Arabic({
  subsets: ["arabic"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-arabic",
  display: "swap",
});

export const metadata: Metadata = {
  title: { default: "Fekerte — AI receptionist for clinics & salons", template: "%s · Fekerte" },
  description: "Online booking, WhatsApp AI and a Lebanese-Arabic voice receptionist that never misses a call.",
  applicationName: "Fekerte",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#0e7490",
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const locale = await getLocale();
  return (
    <html lang={locale} dir={dirOf(locale)} className={`${latin.variable} ${arabic.variable}`}>
      <body className="min-h-dvh">
        <I18nProvider locale={locale}>{children}</I18nProvider>
        <Toaster position="top-center" richColors dir={dirOf(locale)} />
      </body>
    </html>
  );
}
