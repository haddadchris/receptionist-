/**
 * Seed script: plans, a super-admin, "Demo Dental Clinic" (Jbeil) and
 * "Demo Barber Shop" (Achrafieh) with staff, services, hours, customers and
 * appointments spread over the past and next two weeks.
 *
 *   pnpm db:seed           # idempotent: skips businesses that already exist
 */
import "./env";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { and, desc, eq, sql } from "drizzle-orm";
import { DateTime } from "luxon";
import { closeDb } from "./client";
import { withSystem, withTenant, type Tx } from "./tenant";
import { appointments, businesses, calls, campaigns, conversations, customers, jobs, messages, notifications, payments, plans, resources, reviewRequests, services as servicesTable, subscriptions, usageEvents, users, type PlanTier } from "./schema";
import { createUser, findUserByEmail } from "../auth/users";
import {
  addHoliday,
  addTimeOff,
  completeOnboarding,
  createBusiness,
  createService,
  createStaff,
  setBreaks,
  setWeeklyHours,
} from "../business/setup";
import { VERTICAL_PRESETS } from "../business/presets";
import { createBooking, getAvailableSlots, scheduleReminders, setAppointmentStatus, cancelBooking } from "../booking/service";
import { getBusiness } from "../availability/loader";
import type { AppointmentSource } from "./schema";

export const DEMO = {
  adminEmail: process.env.SEED_ADMIN_EMAIL ?? "admin@fekerte.app",
  adminPassword: process.env.SEED_ADMIN_PASSWORD ?? "admin12345",
  dentalOwnerEmail: "owner@demo-dental.com",
  barberOwnerEmail: "owner@demo-barber.com",
  ownerPassword: "demo12345",
  dentalSlug: "demo-dental",
  barberSlug: "demo-barber",
};

export const PLAN_DEFAULTS: { tier: PlanTier; name: string; setup: number; monthly: number; ai: number; voice: number }[] = [
  { tier: "basic", name: "Basic — Online booking", setup: 9900, monthly: 2900, ai: 0, voice: 0 },
  { tier: "standard", name: "Standard — AI WhatsApp receptionist", setup: 19900, monthly: 7900, ai: 1500, voice: 0 },
  { tier: "premium", name: "Premium — AI voice receptionist", setup: 39900, monthly: 19900, ai: 3000, voice: 300 },
];

/** Deterministic PRNG so the demo looks the same on every machine. */
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const FIRST = ["Rami", "Nour", "Elie", "Georges", "Joelle", "Rita", "Karim", "Hadi", "Lara", "Tony", "Nadine", "Fadi", "Rana", "Ziad", "Cynthia", "Charbel", "Mira", "Hassan", "Zeina", "Ali", "Layal", "Marc", "Yara", "Jad", "Christelle", "Bassel", "Dana", "Walid", "Carla", "Samir", "Hiba", "Maroun"];
const LAST = ["Khoury", "Haddad", "Nassar", "Abi Nader", "Gemayel", "Fakhoury", "Hayek", "Sfeir", "Daher", "Karam", "Aoun", "Moussa", "Rizk", "Chidiac", "Bou Saab", "Hamdan", "Salameh", "Mansour", "Azar", "Frem"];
const PREFIXES = ["3", "70", "71", "76", "78", "79", "81"];
const LANGS = ["ar", "ar", "ar", "en", "fr", "en"] as const;

export async function seedPlans(): Promise<void> {
  await withSystem(async (tx) => {
    for (const p of PLAN_DEFAULTS) {
      await tx
        .insert(plans)
        .values({
          tier: p.tier,
          name: p.name,
          setupFeeCents: p.setup,
          monthlyFeeCents: p.monthly,
          includedAiMessages: p.ai,
          includedVoiceMinutes: p.voice,
          overageAiMessageCents: 3,
          overageVoiceMinuteCents: 25,
          features: {
            whatsappAi: p.tier !== "basic",
            webChat: p.tier !== "basic",
            voiceAi: p.tier === "premium",
            deposits: true,
            reviews: p.tier !== "basic",
            recalls: p.tier !== "basic",
            campaigns: p.tier !== "basic",
          },
        })
        .onConflictDoNothing();
    }
  });
}

async function ensureUser(email: string, password: string, name: string, isSuperAdmin = false) {
  return withSystem(async (tx) => {
    const existing = await findUserByEmail(tx, email);
    if (existing) return existing;
    return createUser(tx, { email, password, name, isSuperAdmin });
  });
}

function makeCustomers(count: number, rand: () => number) {
  const seen = new Set<string>();
  const out: { name: string; phone: string; language: (typeof LANGS)[number] }[] = [];
  while (out.length < count) {
    const name = `${FIRST[Math.floor(rand() * FIRST.length)]} ${LAST[Math.floor(rand() * LAST.length)]}`;
    const prefix = PREFIXES[Math.floor(rand() * PREFIXES.length)]!;
    const digits = prefix.length === 1 ? 6 : 6;
    const rest = String(Math.floor(rand() * 10 ** digits)).padStart(digits, "0");
    const phone = `+961${prefix}${rest}`;
    if (seen.has(phone) || seen.has(name)) continue;
    seen.add(phone);
    seen.add(name);
    out.push({ name, phone, language: LANGS[Math.floor(rand() * LANGS.length)]! });
  }
  return out;
}

const SOURCES: AppointmentSource[] = ["dashboard", "booking_page", "booking_page", "whatsapp", "whatsapp", "voice"];

async function seedAppointments(opts: {
  businessId: string;
  serviceIds: string[];
  customers: { name: string; phone: string; language: "ar" | "en" | "fr" }[];
  perDay: number;
  rand: () => number;
}) {
  const { businessId, rand } = opts;
  const business = await withTenant(businessId, (tx) => getBusiness(tx, businessId));
  const tz = business.timezone;
  const today = DateTime.now().setZone(tz).startOf("day");
  const longAgo = today.minus({ days: 60 }).toJSDate();
  let created = 0;
  for (let offset = -14; offset <= 14; offset++) {
    const date = today.plus({ days: offset }).toISODate()!;
    for (let i = 0; i < opts.perDay; i++) {
      const serviceId = opts.serviceIds[Math.floor(rand() * opts.serviceIds.length)]!;
      const slots = await withTenant(businessId, (tx) =>
        getAvailableSlots(tx, businessId, { serviceId, fromDate: date, toDate: date, channel: "internal", now: longAgo }),
      );
      if (!slots.length) continue;
      const slot = slots[Math.floor(rand() * slots.length)]!;
      const customer = opts.customers[Math.floor(rand() * opts.customers.length)]!;
      const source = SOURCES[Math.floor(rand() * SOURCES.length)]!;
      const isPast = offset < 0 || (offset === 0 && Date.parse(slot.start) < Date.now());
      try {
        await withTenant(businessId, async (tx) => {
          const appt = await createBooking(tx, businessId, {
            serviceId,
            staffId: slot.staffIds[0],
            startsAt: slot.start,
            customer,
            source: "dashboard",
            actor: { type: "system", label: "seed" },
            override: true,
            notifyCustomer: false,
            now: longAgo,
          });
          // Record the realistic channel and when the booking was made (1–12 days before, any hour).
          const madeAt = DateTime.fromISO(slot.start)
            .minus({ days: 1 + Math.floor(rand() * 12) })
            .set({ hour: 7 + Math.floor(rand() * 16), minute: Math.floor(rand() * 60) })
            .toJSDate();
          await tx
            .update(appointments)
            .set({ source, createdAt: madeAt.getTime() < Date.now() ? madeAt : new Date(Date.now() - Math.floor(rand() * 6 * 86_400_000)) })
            .where(eq(appointments.id, appt.id));
          const r = rand();
          if (isPast) {
            if (r < 0.8) await setAppointmentStatus(tx, businessId, appt.id, "completed", { type: "system", label: "seed" });
            else if (r < 0.9) await setAppointmentStatus(tx, businessId, appt.id, "no_show", { type: "system", label: "seed" });
            else await cancelBooking(tx, businessId, appt.id, { actor: { type: "system", label: "seed" }, notifyCustomer: false, reason: "Customer called to cancel" });
          } else if (r < 0.1) {
            await tx.update(appointments).set({ status: "pending" }).where(eq(appointments.id, appt.id));
          } else if (r < 0.15) {
            await cancelBooking(tx, businessId, appt.id, { actor: { type: "system", label: "seed" }, notifyCustomer: false });
          } else {
            await scheduleReminders(tx, appt, business);
          }
        });
        created++;
      } catch {
        // Slot taken by an earlier iteration — fine, skip.
      }
    }
  }
  return created;
}

/** Staff, services, hours, breaks, closures of the demo dental clinic (also used by evals). */
export async function setupDentalCatalog(tx: Tx, id: string): Promise<void> {
  const actor = { type: "system" as const, label: "seed" };
  const monFri = [1, 2, 3, 4, 5].map((weekday) => ({ weekday, start: "09:00", end: "18:00" }));
  await setWeeklyHours(tx, id, null, [...monFri, { weekday: 6, start: "09:00", end: "14:00" }]);
  await setBreaks(tx, id, null, [1, 2, 3, 4, 5].map((weekday) => ({ weekday, start: "13:00", end: "14:00", label: "Lunch" })));
  const [lamp] = await tx.insert(resources).values({ businessId: id, name: "Whitening lamp", capacity: 1 }).returning();

  const rami = await createStaff(tx, id, { name: "Dr. Rami Khoury", title: { en: "Dentist", ar: "طبيب أسنان", fr: "Dentiste" }, color: "#0ea5e9", phone: "+9613111222" }, actor);
  const nour = await createStaff(
    tx,
    id,
    {
      name: "Dr. Nour Haddad",
      title: { en: "Dentist & orthodontist", ar: "طبيبة أسنان وتقويم", fr: "Dentiste et orthodontiste" },
      color: "#8b5cf6",
      hours: [
        { weekday: 1, start: "09:00", end: "18:00" },
        { weekday: 3, start: "09:00", end: "18:00" },
        { weekday: 5, start: "09:00", end: "18:00" },
        { weekday: 6, start: "09:00", end: "14:00" },
      ],
    },
    actor,
  );
  const maya = await createStaff(tx, id, { name: "Maya Saade", title: { en: "Dental hygienist", ar: "اختصاصية صحة فم", fr: "Hygiéniste dentaire" }, color: "#10b981" }, actor);

  const dentists = [rami.id, nour.id];
  const svc = [
    { name: { en: "Checkup & consultation", ar: "فحص واستشارة", fr: "Contrôle et consultation" }, durationMinutes: 30, priceCents: 4000, staffIds: dentists, category: "general", recallIntervalDays: 180 },
    { name: { en: "Teeth cleaning", ar: "تنظيف أسنان", fr: "Détartrage et polissage" }, durationMinutes: 45, bufferAfterMinutes: 10, priceCents: 6000, staffIds: [maya.id, nour.id], category: "hygiene", recallIntervalDays: 180 },
    { name: { en: "Filling", ar: "حشوة", fr: "Plombage" }, durationMinutes: 60, priceCents: 8000, priceFrom: true, staffIds: dentists, category: "treatment" },
    { name: { en: "Teeth whitening", ar: "تبييض أسنان", fr: "Blanchiment dentaire" }, durationMinutes: 90, priceCents: 25000, staffIds: [rami.id], category: "cosmetic", resource: true },
    { name: { en: "Root canal treatment", ar: "سحب عصب", fr: "Traitement de canal" }, durationMinutes: 90, priceCents: 30000, priceFrom: true, staffIds: [rami.id], category: "treatment" },
    { name: { en: "Tooth extraction", ar: "قلع ضرس", fr: "Extraction dentaire" }, durationMinutes: 45, priceCents: 10000, priceFrom: true, bufferAfterMinutes: 15, staffIds: dentists, category: "treatment" },
    { name: { en: "Orthodontic consultation", ar: "استشارة تقويم", fr: "Consultation d'orthodontie" }, durationMinutes: 30, priceCents: 5000, staffIds: [nour.id], category: "orthodontics" },
    { name: { en: "Emergency visit", ar: "زيارة طارئة", fr: "Urgence dentaire" }, durationMinutes: 30, priceCents: 6000, staffIds: dentists, category: "general" },
  ];
  for (const s of svc) {
    const { resource, ...rest } = s as typeof s & { resource?: boolean };
    const created = await createService(tx, id, rest, actor);
    if (resource) await tx.update(servicesTable).set({ resourceId: lamp!.id }).where(eq(servicesTable.id, created.id));
  }
  const year = DateTime.now().setZone("Asia/Beirut").year;
  await addHoliday(tx, id, { startDate: `${year}-11-22`, name: "Independence Day" });
  await addHoliday(tx, id, { startDate: `${year}-12-25`, name: "Christmas" });
  await addHoliday(tx, id, { startDate: `${year + 1}-01-01`, name: "New Year" });
  const nextWeek = DateTime.now().setZone("Asia/Beirut").plus({ weeks: 1 }).set({ weekday: 4 }).startOf("day");
  await addTimeOff(tx, id, { staffId: maya.id, startsAt: nextWeek.toJSDate(), endsAt: nextWeek.plus({ days: 1 }).toJSDate(), reason: "Training day" });
}

/** Demo billing history: active subscription, last month paid, usage this month. */
async function seedBilling(businessId: string, opts: { aiMessages: number; voiceMinutes: number; openInvoice: boolean }) {
  const { createInvoice, markInvoicePaid } = await import("../billing/invoices");
  const actor = { type: "system" as const, label: "seed" };
  const now = DateTime.now().setZone("Asia/Beirut");
  await withSystem(async (tx) => {
    await tx.update(subscriptions).set({ status: "active", setupFeePaid: false }).where(eq(subscriptions.businessId, businessId));
    const last = await createInvoice(tx, { businessId, period: now.minus({ months: 1 }).toFormat("yyyy-MM"), actor });
    await markInvoicePaid(tx, { invoiceId: last.id, method: "bank_transfer", reference: "BLOM-TRX-" + last.number.slice(-4), actor });
    if (opts.openInvoice) await createInvoice(tx, { businessId, period: now.toFormat("yyyy-MM"), actor });
    const period = now.toFormat("yyyy-MM");
    if (opts.aiMessages) await tx.insert(usageEvents).values({ businessId, type: "ai_message", quantity: opts.aiMessages, period, metadata: { seed: true } });
    if (opts.voiceMinutes) await tx.insert(usageEvents).values({ businessId, type: "voice_minute", quantity: opts.voiceMinutes, period, metadata: { seed: true } });
  });
}

/**
 * Demo growth data: VIP tags + marketing consent, a deposit on whitening,
 * rated reviews (incl. private feedback), recall reminders, campaigns, and one
 * upcoming appointment waiting for its deposit. Written directly (no WhatsApp sends).
 */
async function seedGrowth(businessId: string, rand: () => number) {
  const now = DateTime.now();
  await withTenant(businessId, async (tx) => {
    const custs = await tx.select().from(customers).where(eq(customers.businessId, businessId));
    for (const [i, c] of custs.entries()) {
      await tx
        .update(customers)
        .set({ consentMarketing: rand() < 0.65, tags: i % 8 === 0 ? ["VIP"] : i % 11 === 0 ? ["braces"] : c.tags })
        .where(eq(customers.id, c.id));
    }
    await tx
      .update(servicesTable)
      .set({ depositRequired: true, depositCents: 5000 })
      .where(and(eq(servicesTable.businessId, businessId), sql`${servicesTable.name}->>'en' = 'Teeth whitening'`));

    // Reviews on recent completed visits.
    const done = await tx
      .select()
      .from(appointments)
      .where(and(eq(appointments.businessId, businessId), eq(appointments.status, "completed")))
      .orderBy(desc(appointments.startsAt))
      .limit(14);
    const RATINGS: { rating: number; feedback?: string }[] = [
      { rating: 5 },
      { rating: 5 },
      { rating: 4 },
      { rating: 2, feedback: "Waited 35 minutes after my appointment time and nobody told me why." },
      { rating: 5 },
      { rating: 5 },
      { rating: 3, feedback: "Dr. was great but parking was impossible, maybe add directions to the lot behind?" },
      { rating: 4 },
      { rating: 5 },
    ];
    const seenCustomers = new Set<string>();
    let r = 0;
    for (const a of done) {
      if (r >= RATINGS.length || seenCustomers.has(a.customerId)) continue;
      seenCustomers.add(a.customerId);
      const spec = RATINGS[r++]!;
      const sentAt = new Date(a.endsAt.getTime() + 2 * 3_600_000);
      await tx.insert(reviewRequests).values({
        businessId,
        appointmentId: a.id,
        customerId: a.customerId,
        status: "rated",
        rating: spec.rating,
        feedback: spec.feedback ?? null,
        sentAt,
        respondedAt: new Date(sentAt.getTime() + 25 * 60_000),
      });
      const [cust] = custs.filter((c) => c.id === a.customerId);
      await tx.insert(notifications).values({
        businessId,
        customerId: a.customerId,
        appointmentId: a.id,
        toAddress: cust!.phone,
        templateName: "review_request",
        language: "en",
        body: "Thanks for visiting Demo Dental Clinic 🙏 How would you rate your experience from 1 to 5? Just reply with a number.",
        status: "read",
        sentAt,
      });
    }

    // Recall reminders sent ~10 days ago, a couple of which rebooked.
    for (const c of custs.slice(0, 6)) {
      await tx.insert(notifications).values({
        businessId,
        customerId: c.id,
        toAddress: c.phone,
        templateName: "recall_reminder",
        language: c.preferredLanguage ?? "ar",
        body: "Hi 👋 It's time for your next Teeth cleaning at Demo Dental Clinic. Book here or just reply to this message.",
        status: "delivered",
        sentAt: now.minus({ days: 10 }).toJSDate(),
        createdAt: now.minus({ days: 10 }).toJSDate(),
      });
    }

    // Campaigns: one sent, one draft.
    const [sent] = await tx
      .insert(campaigns)
      .values({
        businessId,
        name: "Back-to-school checkups",
        segment: { noVisitDays: 180 },
        templateName: "campaign_generic",
        variables: { message: "Book your child's back-to-school checkup this month and get a free fluoride treatment." },
        status: "sent",
        scheduledAt: now.minus({ days: 20 }).toJSDate(),
        sentAt: now.minus({ days: 20 }).toJSDate(),
      })
      .returning();
    const optedIn = custs.filter((c) => c.consentMarketing).slice(0, 9);
    for (const c of optedIn) {
      await tx.insert(notifications).values({
        businessId,
        customerId: c.id,
        campaignId: sent!.id,
        toAddress: c.phone,
        templateName: "campaign_generic",
        language: c.preferredLanguage ?? "ar",
        body: "Hi, a message from Demo Dental Clinic: Book your child's back-to-school checkup this month and get a free fluoride treatment. (reply STOP to opt out)",
        status: "delivered",
        sentAt: now.minus({ days: 20 }).toJSDate(),
        createdAt: now.minus({ days: 20 }).toJSDate(),
      });
    }
    await tx.update(campaigns).set({ recipientCount: optedIn.length, sentCount: optedIn.length }).where(eq(campaigns.id, sent!.id));
    await tx.insert(campaigns).values({
      businessId,
      name: "Whitening offer",
      segment: { tags: ["VIP"] },
      templateName: "campaign_generic",
      variables: { message: "As one of our VIP patients, enjoy 20% off teeth whitening until the end of the month." },
      status: "draft",
    });

    // One upcoming appointment held for its deposit, one with a paid deposit.
    const upcoming = await tx
      .select()
      .from(appointments)
      .where(and(eq(appointments.businessId, businessId), eq(appointments.status, "confirmed"), sql`${appointments.startsAt} > now() + interval '1 day'`))
      .orderBy(appointments.startsAt)
      .limit(2);
    if (upcoming[0]) {
      const due = new Date(Math.min(Date.now() + 10 * 3_600_000, upcoming[0].startsAt.getTime() - 3_600_000));
      await tx.update(appointments).set({ status: "pending", depositStatus: "required", depositCents: 5000, depositDueAt: due }).where(eq(appointments.id, upcoming[0].id));
      await tx.insert(payments).values({ businessId, appointmentId: upcoming[0].id, kind: "deposit", amountCents: 5000, method: "other", provider: "manual", providerRef: `D-${upcoming[0].id.slice(0, 6).toUpperCase()}`, status: "pending" });
    }
    if (upcoming[1]) {
      await tx.update(appointments).set({ depositStatus: "paid", depositCents: 5000 }).where(eq(appointments.id, upcoming[1].id));
      await tx.insert(payments).values({ businessId, appointmentId: upcoming[1].id, kind: "deposit", amountCents: 5000, method: "wallet", provider: "manual", providerRef: "WHISH-48213", status: "succeeded" });
    }
  });
  await cancelSeedGrowthJobs(businessId);
}

/** Seeded history must not trigger review/recall sends on the first `pnpm dev`. */
async function cancelSeedGrowthJobs(businessId: string) {
  await withSystem((tx) =>
    tx
      .update(jobs)
      .set({ status: "cancelled" })
      .where(and(eq(jobs.businessId, businessId), eq(jobs.status, "pending"), sql`${jobs.type} in ('review.request', 'recall.send') and ${jobs.runAt} < now() + interval '1 day'`)),
  );
}

/** Demo channel history: WhatsApp conversations behind WhatsApp bookings, AI phone calls behind voice bookings. */
async function seedChannelHistory(businessId: string, voiceNumber: string | null, rand: () => number) {
  await withTenant(businessId, async (tx) => {
    const rows = await tx
      .select({ a: appointments, phone: customers.phone, name: customers.name, lang: customers.preferredLanguage, service: servicesTable.name })
      .from(appointments)
      .innerJoin(customers, eq(customers.id, appointments.customerId))
      .innerJoin(servicesTable, eq(servicesTable.id, appointments.serviceId))
      .where(and(eq(appointments.businessId, businessId), sql`${appointments.source} in ('whatsapp', 'voice')`))
      .orderBy(desc(appointments.createdAt));
    const convoByCustomer = new Map<string, string>();
    let staffTouched = 0;
    for (const r of rows) {
      const at = r.a.createdAt;
      const svc = r.service.en ?? Object.values(r.service)[0] ?? "appointment";
      if (r.a.source === "voice") {
        if (!voiceNumber) continue; // no AI phone line on this plan
        const duration = 70 + Math.floor(rand() * 150);
        await tx.insert(calls).values({
          businessId,
          customerId: r.a.customerId,
          appointmentId: r.a.id,
          provider: "twilio",
          direction: "inbound",
          fromNumber: r.phone,
          toNumber: voiceNumber,
          pipeline: "cascade",
          startedAt: at,
          endedAt: new Date(at.getTime() + duration * 1000),
          durationSeconds: duration,
          summary: `Caller booked ${svc}; read-back confirmed.`,
          outcome: "booked",
          transcript: [],
          createdAt: at,
        });
        continue;
      }
      let convoId = convoByCustomer.get(r.a.customerId);
      if (!convoId) {
        const [c] = await tx
          .insert(conversations)
          .values({ businessId, customerId: r.a.customerId, channel: "whatsapp", externalId: r.phone, status: "closed", language: r.lang ?? "ar", lastMessageAt: new Date(at.getTime() + 40_000), lastInboundAt: at, createdAt: at })
          .returning();
        convoId = c!.id;
        convoByCustomer.set(r.a.customerId, convoId);
      }
      await tx.insert(messages).values([
        { businessId, conversationId: convoId, direction: "inbound", sender: "customer", body: `Marhaba, baddi e7joz ${svc}`, createdAt: at },
        { businessId, conversationId: convoId, direction: "outbound", sender: "ai", body: `Tamem ✅ 7ajaztellak ${svc}. Ra7 yousalak ta2kid 3al WhatsApp.`, status: "read", createdAt: new Date(at.getTime() + 20_000) },
      ]);
      if (staffTouched < 4 && rand() < 0.2) {
        staffTouched++;
        await tx.insert(messages).values({ businessId, conversationId: convoId, direction: "outbound", sender: "staff", body: "Ahla w sahla! Shoufak 2arib 🙏", createdAt: new Date(at.getTime() + 600_000) });
      }
      await tx.update(appointments).set({ conversationId: convoId }).where(eq(appointments.id, r.a.id));
    }
    // Calls and chats that didn't end in a booking (questions, hang-ups).
    const now = DateTime.now();
    const QUESTIONS = ["adesh el tanzif?", "Do you have parking?", "شو الدوام نهار السبت؟", "Est-ce que vous prenez les assurances ?", "fi dr 3al sabt?", "How much is whitening?"];
    for (const [i, q] of QUESTIONS.entries()) {
      const at = now.minus({ days: 1 + Math.floor(rand() * 25), hours: Math.floor(rand() * 10) }).toJSDate();
      const phone = `+96176${String(200000 + i * 7919).padStart(6, "0")}`;
      const [cust] = await tx.insert(customers).values({ businessId, phone, name: null, source: "whatsapp", createdAt: at }).onConflictDoNothing().returning();
      if (!cust) continue;
      const [c] = await tx
        .insert(conversations)
        .values({ businessId, customerId: cust.id, channel: "whatsapp", externalId: phone, status: "closed", lastMessageAt: new Date(at.getTime() + 15_000), lastInboundAt: at, createdAt: at })
        .returning();
      await tx.insert(messages).values([
        { businessId, conversationId: c!.id, direction: "inbound", sender: "customer", body: q, createdAt: at },
        { businessId, conversationId: c!.id, direction: "outbound", sender: "ai", body: "Ahla! Hayda el jaweb 🙏 Baddak e7jozlak maw3ad?", status: "read", createdAt: new Date(at.getTime() + 15_000) },
      ]);
    }
    for (let i = 0; voiceNumber && i < 9; i++) {
      const at = now.minus({ days: Math.floor(rand() * 28), hours: Math.floor(rand() * 8) }).toJSDate();
      const missed = i >= 6;
      await tx.insert(calls).values({
        businessId,
        provider: "twilio",
        direction: "inbound",
        fromNumber: `+96170${String(100000 + Math.floor(rand() * 899999))}`,
        toNumber: voiceNumber,
        pipeline: "cascade",
        startedAt: at,
        endedAt: new Date(at.getTime() + (missed ? 6 : 60) * 1000),
        durationSeconds: missed ? 6 : 60,
        summary: missed ? "Caller hung up before speaking." : "Caller asked about prices and opening hours.",
        outcome: missed ? "abandoned" : "info",
        transcript: [],
        createdAt: at,
      });
    }
  });
}

async function seedDental(ownerId: string) {
  const existing = await withSystem((tx) => tx.select().from(businesses).where(eq(businesses.slug, DEMO.dentalSlug)));
  if (existing.length) return { businessId: existing[0]!.id, skipped: true };
  const rand = rng(961);
  const business = await withSystem((tx) =>
    createBusiness(tx, {
      ownerUserId: ownerId,
      name: "Demo Dental Clinic",
      slug: DEMO.dentalSlug,
      vertical: "dental",
      defaultLanguage: "ar",
      phone: "+9619540123",
      email: "hello@demo-dental.com",
      address: "Main Road, near the old souk, Jbeil",
      city: "Jbeil",
      planTier: "premium",
      withDefaultHours: false,
    }),
  );
  const id = business.id;
  await withSystem((tx) =>
    tx
      .update(businesses)
      .set({
        status: "active",
        whatsappNumber: "+96170123456",
        whatsappPhoneNumberId: "demo-dental-wa",
        voiceNumber: "+12025550147",
        mapsUrl: "https://maps.google.com/?q=Jbeil+Lebanon",
        googleReviewUrl: "https://g.page/r/demo-dental/review",
        branding: {
          primaryColor: "#0e7490",
          tagline: { en: "Gentle dental care in the heart of Jbeil", ar: "عناية لطيفة بأسنانك بقلب جبيل", fr: "Des soins dentaires tout en douceur au cœur de Byblos" },
        },
        aiSettings: {
          personaName: "Maya",
          tone: "warm",
          voicePipeline: "cascade",
          voiceMode: "always",
          overflowRingSeconds: 20,
          transferNumber: "+9619540123",
          whatsappAutoReply: true,
          extraInstructions: "Parking is available behind the clinic. We accept cash (USD) and bank transfer.",
        },
        bookingSettings: {
          minNoticeMinutes: 120,
          maxDaysAhead: 60,
          slotGranularityMinutes: 15,
          allowAnyStaff: true,
          requireApproval: false,
          cancellationNoticeHours: 12,
          reminderOffsetsMinutes: [1440, 120],
          askConfirmation: true,
          depositHoldHours: 12,
          depositAfterNoShows: 2,
          policies: {
            en: "Please arrive 10 minutes early. Cancellations less than 12 hours before the appointment may be charged.",
            ar: "الرجاء الحضور قبل 10 دقايق. الإلغاء قبل أقل من 12 ساعة من الموعد ممكن ينحسب.",
            fr: "Merci d'arriver 10 minutes en avance. Les annulations moins de 12 heures avant peuvent être facturées.",
          },
        },
      })
      .where(eq(businesses.id, id)),
  );

  await withTenant(id, async (tx) => {
    await setupDentalCatalog(tx, id);
    await completeOnboarding(tx, id);
  });

  const serviceIds = (await withTenant(id, (tx) => tx.select({ id: servicesTable.id }).from(servicesTable))).map((s) => s.id);
  const customers = makeCustomers(32, rand);
  const n = await seedAppointments({ businessId: id, serviceIds, customers, perDay: 7, rand });
  await seedBilling(id, { aiMessages: 412, voiceMinutes: 96, openInvoice: false });
  await seedGrowth(id, rand);
  await seedChannelHistory(id, "+12025550147", rand);
  return { businessId: id, skipped: false, appointments: n };
}

async function seedBarber(ownerId: string) {
  const existing = await withSystem((tx) => tx.select().from(businesses).where(eq(businesses.slug, DEMO.barberSlug)));
  if (existing.length) return { businessId: existing[0]!.id, skipped: true };
  const rand = rng(1975);
  const business = await withSystem((tx) =>
    createBusiness(tx, {
      ownerUserId: ownerId,
      name: "Demo Barber Shop",
      slug: DEMO.barberSlug,
      vertical: "barber",
      defaultLanguage: "en",
      phone: "+9611200300",
      address: "Sassine Square, Achrafieh",
      city: "Beirut",
      planTier: "standard",
    }),
  );
  const id = business.id;
  await withSystem((tx) =>
    tx
      .update(businesses)
      .set({ status: "active", whatsappNumber: "+96171999888", whatsappPhoneNumberId: "demo-barber-wa", branding: { primaryColor: "#b45309" } })
      .where(eq(businesses.id, id)),
  );
  await withTenant(id, async (tx) => {
    const actor = { type: "system" as const, label: "seed" };
    const tony = await createStaff(tx, id, { name: "Tony", title: { en: "Senior barber", ar: "حلاق", fr: "Barbier" } }, actor);
    const karim = await createStaff(tx, id, { name: "Karim", title: { en: "Barber", ar: "حلاق", fr: "Barbier" } }, actor);
    for (const s of VERTICAL_PRESETS.barber.services) {
      await createService(tx, id, { ...s, staffIds: [tony.id, karim.id] }, actor);
    }
    await completeOnboarding(tx, id);
  });
  const serviceIds = (await withTenant(id, (tx) => tx.select({ id: servicesTable.id }).from(servicesTable))).map((s) => s.id);
  const n = await seedAppointments({ businessId: id, serviceIds, customers: makeCustomers(12, rand), perDay: 4, rand });
  await seedBilling(id, { aiMessages: 188, voiceMinutes: 0, openInvoice: true });
  await seedChannelHistory(id, null, rand);
  await cancelSeedGrowthJobs(id);
  return { businessId: id, skipped: false, appointments: n };
}

export async function seed(): Promise<void> {
  await seedPlans();
  await ensureUser(DEMO.adminEmail, DEMO.adminPassword, "Fekerte Admin", true);
  const dentalOwner = await ensureUser(DEMO.dentalOwnerEmail, DEMO.ownerPassword, "Dr. Rami Khoury");
  const barberOwner = await ensureUser(DEMO.barberOwnerEmail, DEMO.ownerPassword, "Tony Barber");
  const dental = await seedDental(dentalOwner.id);
  const barber = await seedBarber(barberOwner.id);
  const [{ n } = { n: 0 }] = await withSystem((tx) => tx.select({ n: sql<number>`count(*)::int` }).from(users));
  console.log("✓ seed complete", { users: n, dental, barber });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  seed()
    .then(() => {
      console.log(`
  Demo logins (password auth):
    super admin   ${DEMO.adminEmail} / ${DEMO.adminPassword}
    dental owner  ${DEMO.dentalOwnerEmail} / ${DEMO.ownerPassword}
    barber owner  ${DEMO.barberOwnerEmail} / ${DEMO.ownerPassword}
  Booking pages: /b/${DEMO.dentalSlug}  /b/${DEMO.barberSlug}
`);
    })
    .catch((e) => {
      console.error(e);
      process.exitCode = 1;
    })
    .finally(() => closeDb());
}
