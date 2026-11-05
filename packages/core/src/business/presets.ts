/** Vertical presets used by onboarding ("quick start") and the seed script. */
import type { LocalizedText } from "../db/schema";
import type { WeeklyRule } from "../availability/engine";

export type Vertical = "dental" | "clinic" | "physio" | "aesthetic" | "salon" | "barber" | "other";

export const VERTICALS: { id: Vertical; label: LocalizedText }[] = [
  { id: "dental", label: { en: "Dental clinic", ar: "عيادة أسنان", fr: "Cabinet dentaire" } },
  { id: "clinic", label: { en: "Medical clinic", ar: "عيادة طبية", fr: "Cabinet médical" } },
  { id: "physio", label: { en: "Physiotherapy", ar: "علاج فيزيائي", fr: "Kinésithérapie" } },
  { id: "aesthetic", label: { en: "Aesthetic clinic", ar: "عيادة تجميل", fr: "Clinique esthétique" } },
  { id: "salon", label: { en: "Beauty salon", ar: "صالون تجميل", fr: "Salon de beauté" } },
  { id: "barber", label: { en: "Barber shop", ar: "صالون حلاقة", fr: "Barbier" } },
  { id: "other", label: { en: "Other", ar: "غير ذلك", fr: "Autre" } },
];

export type ServicePreset = {
  name: LocalizedText;
  durationMinutes: number;
  priceCents: number | null;
  priceFrom?: boolean;
  bufferAfterMinutes?: number;
  category?: string;
  recallIntervalDays?: number;
};

const days = (from: number, to: number, start: string, end: string): WeeklyRule[] =>
  Array.from({ length: to - from + 1 }, (_, i) => ({ weekday: from + i, start, end }));

export const VERTICAL_PRESETS: Record<Vertical, { hours: WeeklyRule[]; services: ServicePreset[] }> = {
  dental: {
    hours: [...days(1, 5, "09:00", "18:00"), { weekday: 6, start: "09:00", end: "14:00" }],
    services: [
      { name: { en: "Checkup & consultation", ar: "فحص واستشارة", fr: "Contrôle et consultation" }, durationMinutes: 30, priceCents: 4000, category: "general", recallIntervalDays: 180 },
      { name: { en: "Teeth cleaning", ar: "تنظيف أسنان", fr: "Détartrage" }, durationMinutes: 45, priceCents: 6000, bufferAfterMinutes: 10, category: "hygiene", recallIntervalDays: 180 },
      { name: { en: "Filling", ar: "حشوة", fr: "Plombage" }, durationMinutes: 60, priceCents: 8000, priceFrom: true, category: "treatment" },
      { name: { en: "Teeth whitening", ar: "تبييض أسنان", fr: "Blanchiment dentaire" }, durationMinutes: 90, priceCents: 25000, category: "cosmetic" },
    ],
  },
  clinic: {
    hours: [...days(1, 5, "09:00", "17:00"), { weekday: 6, start: "09:00", end: "13:00" }],
    services: [
      { name: { en: "Consultation", ar: "معاينة", fr: "Consultation" }, durationMinutes: 20, priceCents: 5000 },
      { name: { en: "Follow-up visit", ar: "زيارة متابعة", fr: "Visite de suivi" }, durationMinutes: 15, priceCents: 3000 },
    ],
  },
  physio: {
    hours: [...days(1, 5, "08:00", "19:00"), { weekday: 6, start: "09:00", end: "14:00" }],
    services: [
      { name: { en: "Initial assessment", ar: "تقييم أوّلي", fr: "Bilan initial" }, durationMinutes: 60, priceCents: 5000 },
      { name: { en: "Physiotherapy session", ar: "جلسة علاج فيزيائي", fr: "Séance de kinésithérapie" }, durationMinutes: 45, priceCents: 3500 },
    ],
  },
  aesthetic: {
    hours: [...days(1, 6, "10:00", "19:00")],
    services: [
      { name: { en: "Consultation", ar: "استشارة", fr: "Consultation" }, durationMinutes: 30, priceCents: 0 },
      { name: { en: "Botox", ar: "بوتوكس", fr: "Botox" }, durationMinutes: 30, priceCents: 25000, priceFrom: true },
      { name: { en: "Laser hair removal", ar: "إزالة الشعر بالليزر", fr: "Épilation laser" }, durationMinutes: 45, priceCents: 6000, priceFrom: true, recallIntervalDays: 42 },
    ],
  },
  salon: {
    hours: [...days(2, 7, "10:00", "20:00")],
    services: [
      { name: { en: "Blow-dry", ar: "سشوار", fr: "Brushing" }, durationMinutes: 45, priceCents: 2000 },
      { name: { en: "Haircut", ar: "قصّ شعر", fr: "Coupe" }, durationMinutes: 45, priceCents: 2500 },
      { name: { en: "Hair color", ar: "صبغة شعر", fr: "Coloration" }, durationMinutes: 120, priceCents: 6000, priceFrom: true },
      { name: { en: "Manicure", ar: "مانيكور", fr: "Manucure" }, durationMinutes: 45, priceCents: 1500 },
    ],
  },
  barber: {
    hours: [...days(2, 7, "10:00", "20:00")],
    services: [
      { name: { en: "Haircut", ar: "قصّ شعر", fr: "Coupe homme" }, durationMinutes: 30, priceCents: 1500, recallIntervalDays: 21 },
      { name: { en: "Beard trim", ar: "تشذيب دقن", fr: "Taille de barbe" }, durationMinutes: 20, priceCents: 1000 },
      { name: { en: "Haircut + beard", ar: "شعر ودقن", fr: "Coupe + barbe" }, durationMinutes: 45, priceCents: 2200 },
      { name: { en: "Kids haircut", ar: "قصّ شعر ولاد", fr: "Coupe enfant" }, durationMinutes: 20, priceCents: 1000 },
    ],
  },
  other: {
    hours: [...days(1, 5, "09:00", "17:00")],
    services: [{ name: { en: "Appointment", ar: "موعد", fr: "Rendez-vous" }, durationMinutes: 30, priceCents: null }],
  },
};

export const STAFF_COLORS = ["#0ea5e9", "#8b5cf6", "#10b981", "#f59e0b", "#ef4444", "#ec4899", "#14b8a6", "#6366f1"];
