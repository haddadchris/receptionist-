/**
 * WhatsApp message templates. Business-initiated WhatsApp messages outside the
 * 24h customer-service window must use templates pre-approved by Meta. Each
 * template below must be registered in WhatsApp Manager with the same name,
 * language code and positional variables ({{1}}, {{2}}, …). See README
 * "Connecting WhatsApp" for the registration checklist.
 */
import type { Locale } from "../db/schema";

export type TemplateName =
  | "appointment_confirmation"
  | "appointment_pending"
  | "appointment_reminder"
  | "appointment_reminder_confirm"
  | "appointment_rescheduled"
  | "appointment_cancelled"
  | "deposit_request"
  | "review_request"
  | "recall_reminder"
  | "campaign_generic";

export type TemplateDef = {
  name: TemplateName;
  category: "UTILITY" | "MARKETING";
  /** Human description of each positional variable, in order. */
  variables: string[];
  body: Record<Locale, string>;
};

/** Meta language codes for our locales. */
export const META_LANGUAGE: Record<Locale, string> = { ar: "ar", en: "en", fr: "fr" };

export const TEMPLATES: Record<TemplateName, TemplateDef> = {
  appointment_confirmation: {
    name: "appointment_confirmation",
    category: "UTILITY",
    variables: ["customer name", "service", "business", "date & time", "manage link"],
    body: {
      ar: "مرحبا {{1}} 👋 تأكّد موعدك لـ {{2}} عند {{3}}، {{4}}. لتغيير أو إلغاء الموعد: {{5}}",
      en: "Hi {{1}} 👋 Your {{2}} appointment at {{3}} is confirmed for {{4}}. To reschedule or cancel: {{5}}",
      fr: "Bonjour {{1}} 👋 Votre rendez-vous {{2}} chez {{3}} est confirmé pour {{4}}. Pour modifier ou annuler : {{5}}",
    },
  },
  appointment_pending: {
    name: "appointment_pending",
    category: "UTILITY",
    variables: ["customer name", "service", "business", "date & time", "manage link"],
    body: {
      ar: "مرحبا {{1}}، وصلنا طلب موعدك لـ {{2}} عند {{3}}، {{4}}. رح نأكّدلك ياه بأقرب وقت. {{5}}",
      en: "Hi {{1}}, we received your request for {{2}} at {{3}}, {{4}}. We'll confirm it shortly. {{5}}",
      fr: "Bonjour {{1}}, nous avons reçu votre demande pour {{2}} chez {{3}}, {{4}}. Nous la confirmerons rapidement. {{5}}",
    },
  },
  appointment_reminder: {
    name: "appointment_reminder",
    category: "UTILITY",
    variables: ["customer name", "service", "business", "date & time", "manage link"],
    body: {
      ar: "تذكير 🗓️ {{1}}، عندك موعد {{2}} عند {{3}}، {{4}}. لتغيير الموعد: {{5}}",
      en: "Reminder 🗓️ {{1}}, you have a {{2}} appointment at {{3}}, {{4}}. To reschedule: {{5}}",
      fr: "Rappel 🗓️ {{1}}, vous avez un rendez-vous {{2}} chez {{3}}, {{4}}. Pour modifier : {{5}}",
    },
  },
  appointment_reminder_confirm: {
    name: "appointment_reminder_confirm",
    category: "UTILITY",
    variables: ["customer name", "service", "business", "date & time", "manage link"],
    body: {
      ar: "تذكير 🗓️ {{1}}، عندك موعد {{2}} عند {{3}}، {{4}}. ردّ 1 للتأكيد أو 2 لتغيير الموعد. {{5}}",
      en: "Reminder 🗓️ {{1}}, you have a {{2}} appointment at {{3}}, {{4}}. Reply 1 to confirm or 2 to reschedule. {{5}}",
      fr: "Rappel 🗓️ {{1}}, vous avez un rendez-vous {{2}} chez {{3}}, {{4}}. Répondez 1 pour confirmer ou 2 pour modifier. {{5}}",
    },
  },
  appointment_rescheduled: {
    name: "appointment_rescheduled",
    category: "UTILITY",
    variables: ["customer name", "service", "business", "new date & time", "manage link"],
    body: {
      ar: "مرحبا {{1}}، تغيّر موعدك لـ {{2}} عند {{3}}. الموعد الجديد: {{4}}. {{5}}",
      en: "Hi {{1}}, your {{2}} appointment at {{3}} has been moved to {{4}}. {{5}}",
      fr: "Bonjour {{1}}, votre rendez-vous {{2}} chez {{3}} a été déplacé au {{4}}. {{5}}",
    },
  },
  appointment_cancelled: {
    name: "appointment_cancelled",
    category: "UTILITY",
    variables: ["customer name", "service", "business", "date & time", "booking link"],
    body: {
      ar: "مرحبا {{1}}، تلغى موعدك لـ {{2}} عند {{3}} ({{4}}). لحجز موعد جديد: {{5}}",
      en: "Hi {{1}}, your {{2}} appointment at {{3}} ({{4}}) has been cancelled. To book again: {{5}}",
      fr: "Bonjour {{1}}, votre rendez-vous {{2}} chez {{3}} ({{4}}) a été annulé. Pour reprendre rendez-vous : {{5}}",
    },
  },
  deposit_request: {
    name: "deposit_request",
    category: "UTILITY",
    variables: ["customer name", "deposit amount", "service", "date & time", "payment link / instructions"],
    body: {
      ar: "مرحبا {{1}}، لتثبيت موعدك لـ {{3}} ({{4}}) منطلب عربون {{2}}. {{5}}",
      en: "Hi {{1}}, to secure your {{3}} appointment ({{4}}) we need a deposit of {{2}}. {{5}}",
      fr: "Bonjour {{1}}, pour confirmer votre rendez-vous {{3}} ({{4}}), un acompte de {{2}} est requis. {{5}}",
    },
  },
  review_request: {
    name: "review_request",
    category: "UTILITY",
    variables: ["customer name", "business"],
    body: {
      ar: "شكراً لزيارتك {{1}} 🙏 قديش بتقيّم تجربتك عند {{2}} من 1 لـ 5؟ ردّ بالرقم.",
      en: "Thanks for visiting {{2}}, {{1}} 🙏 How would you rate your experience from 1 to 5? Just reply with a number.",
      fr: "Merci de votre visite chez {{2}}, {{1}} 🙏 Comment évaluez-vous votre expérience de 1 à 5 ? Répondez simplement par un chiffre.",
    },
  },
  recall_reminder: {
    name: "recall_reminder",
    category: "UTILITY",
    variables: ["customer name", "service", "business", "booking link"],
    body: {
      ar: "مرحبا {{1}} 👋 صار وقت {{2}} عند {{3}}. احجز موعدك من هون: {{4}} أو ردّ علينا هون.",
      en: "Hi {{1}} 👋 It's time for your next {{2}} at {{3}}. Book here: {{4}} or just reply to this message.",
      fr: "Bonjour {{1}} 👋 C'est le moment de votre prochain {{2}} chez {{3}}. Réservez ici : {{4}} ou répondez à ce message.",
    },
  },
  campaign_generic: {
    name: "campaign_generic",
    category: "MARKETING",
    variables: ["customer name", "business", "message"],
    body: {
      ar: "مرحبا {{1}}، رسالة من {{2}}: {{3}} (لإيقاف الرسائل ردّ STOP)",
      en: "Hi {{1}}, a message from {{2}}: {{3}} (reply STOP to opt out)",
      fr: "Bonjour {{1}}, un message de {{2}} : {{3}} (répondez STOP pour vous désabonner)",
    },
  },
};

export function renderTemplate(name: TemplateName, locale: Locale, vars: string[]): string {
  const def = TEMPLATES[name];
  return def.body[locale].replace(/\{\{(\d+)\}\}/g, (_, n: string) => vars[Number(n) - 1] ?? "");
}
