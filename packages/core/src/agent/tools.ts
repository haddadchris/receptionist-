/**
 * Receptionist agent tools, shared by WhatsApp, web chat and voice.
 *
 * Security model: tools never trust identity from the model. The customer's
 * phone comes from the channel (WhatsApp sender / caller ID). Appointment
 * look-ups and changes are restricted to that customer's appointments (or, on
 * unverified web chat, to appointments created in the same conversation).
 * All inputs are validated with zod; times are exchanged as business-local
 * "YYYY-MM-DDTHH:mm" strings.
 */
import { and, eq, gte } from "drizzle-orm";
import { DateTime } from "luxon";
import { z } from "zod";
import type { Tx } from "../db/tenant";
import { appointments, holidays, type AgentState, type Business, type ConversationLanguage, type Locale } from "../db/schema";
import {
  cancelBooking,
  createBooking,
  findCustomerAppointments,
  getAppointmentView,
  getAvailableSlots,
  rescheduleBooking,
} from "../booking/service";
import { bookingSettings } from "../availability/loader";
import { getBreaks, getStaffServiceLinks, getWeeklyHours, listServices, listStaff } from "../business/setup";
import { isDomainError } from "../lib/errors";
import { pickLocalized } from "../lib/i18n";
import { normalizePhone } from "../lib/phone";
import { spokenDateTime } from "../lib/spoken";
import { formatPrice } from "../lib/time";
import type { ToolDef } from "./llm/types";

export type ToolContext = {
  tx: Tx;
  business: Business;
  channel: "whatsapp" | "voice" | "web_chat";
  conversationId: string;
  /** Phone verified by the channel (WhatsApp sender, caller ID). Null on web chat. */
  verifiedPhone: string | null;
  customerId: string | null;
  customerName: string | null;
  language: ConversationLanguage;
  state: AgentState;
  now: Date;
  effects: ToolEffects;
};

export type ToolEffects = {
  handoff?: { reason: string; urgency: "normal" | "urgent" };
  messageTaken?: { message: string; callbackRequested: boolean; callbackPhone?: string | null };
  bookedAppointmentIds: string[];
  rescheduledAppointmentIds: string[];
  cancelledAppointmentIds: string[];
  customerId?: string;
};

const localDateTime = z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/, "use YYYY-MM-DDTHH:mm (business local time)");
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "use YYYY-MM-DD");
const uuid = z.string().uuid();

const schemas = {
  get_business_info: z.object({}).strict(),
  list_services: z.object({}).strict(),
  check_availability: z
    .object({
      service_id: uuid,
      date: isoDate.optional(),
      staff_id: uuid.optional(),
      part_of_day: z.enum(["morning", "afternoon", "evening", "any"]).optional(),
      preferred_time: z.string().regex(/^\d{1,2}:\d{2}$/).optional(),
    })
    .strict(),
  create_booking: z
    .object({
      service_id: uuid,
      start: localDateTime,
      staff_id: uuid.optional(),
      customer_name: z.string().trim().min(2).max(100).optional(),
      customer_phone: z.string().max(30).optional(),
      notes: z.string().max(500).optional(),
    })
    .strict(),
  find_customer_appointments: z.object({}).strict(),
  reschedule_booking: z.object({ appointment_id: uuid, new_start: localDateTime, staff_id: uuid.optional() }).strict(),
  cancel_booking: z.object({ appointment_id: uuid, reason: z.string().max(300).optional() }).strict(),
  handoff_to_human: z.object({ reason: z.string().min(2).max(300), urgency: z.enum(["normal", "urgent"]).optional() }).strict(),
  take_message: z
    .object({ message: z.string().min(2).max(1000), callback_requested: z.boolean().optional(), callback_phone: z.string().max(30).optional() })
    .strict(),
} as const;

export type ToolName = keyof typeof schemas;

export const TOOL_DEFS: ToolDef[] = [
  {
    name: "get_business_info",
    description: "Business facts: address, phone, opening hours per weekday, upcoming closures, policies. Use for any question about location, hours or policies.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "list_services",
    description: "All bookable services with service_id, duration, price (USD) and who performs them. Use for price questions and to find the service_id.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "check_availability",
    description:
      "Free appointment times for a service. Always call this before offering times — never guess availability. If the requested date is full it returns the next available days instead.",
    inputSchema: {
      type: "object",
      properties: {
        service_id: { type: "string", description: "service_id from the catalog" },
        date: { type: "string", description: "Business-local date YYYY-MM-DD. Omit for 'as soon as possible'." },
        staff_id: { type: "string", description: "Only if the customer asked for a specific person" },
        part_of_day: { type: "string", enum: ["morning", "afternoon", "evening", "any"] },
        preferred_time: { type: "string", description: "HH:mm (24h) if the customer named a time, e.g. 16:30" },
      },
      required: ["service_id"],
      additionalProperties: false,
    },
  },
  {
    name: "create_booking",
    description:
      "Book an appointment. Only call after the customer chose a specific time returned by check_availability. The booking exists ONLY if this returns ok:true — never tell the customer it is booked otherwise.",
    inputSchema: {
      type: "object",
      properties: {
        service_id: { type: "string" },
        start: { type: "string", description: "Business-local start, YYYY-MM-DDTHH:mm, exactly as returned by check_availability" },
        staff_id: { type: "string", description: "staff_id from the chosen slot" },
        customer_name: { type: "string", description: "Customer's full name (required for new customers)" },
        customer_phone: { type: "string", description: "Only on web chat, when the customer gives their mobile number" },
        notes: { type: "string" },
      },
      required: ["service_id", "start"],
      additionalProperties: false,
    },
  },
  {
    name: "find_customer_appointments",
    description: "The current customer's upcoming appointments (with appointment_id). Use before rescheduling or cancelling.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "reschedule_booking",
    description: "Move one of the current customer's appointments to a new free time (check availability first).",
    inputSchema: {
      type: "object",
      properties: {
        appointment_id: { type: "string" },
        new_start: { type: "string", description: "Business-local YYYY-MM-DDTHH:mm from check_availability" },
        staff_id: { type: "string" },
      },
      required: ["appointment_id", "new_start"],
      additionalProperties: false,
    },
  },
  {
    name: "cancel_booking",
    description: "Cancel one of the current customer's appointments after they clearly asked to cancel.",
    inputSchema: {
      type: "object",
      properties: { appointment_id: { type: "string" }, reason: { type: "string" } },
      required: ["appointment_id"],
      additionalProperties: false,
    },
  },
  {
    name: "handoff_to_human",
    description:
      "Hand the conversation to a staff member: complaints, emergencies (pain, bleeding, swelling, accident), anger, medical questions, requests for a human, or when you are stuck.",
    inputSchema: {
      type: "object",
      properties: { reason: { type: "string" }, urgency: { type: "string", enum: ["normal", "urgent"] } },
      required: ["reason"],
      additionalProperties: false,
    },
  },
  {
    name: "take_message",
    description: "Leave a message for the team (e.g. a question you cannot answer, a callback request).",
    inputSchema: {
      type: "object",
      properties: { message: { type: "string" }, callback_requested: { type: "boolean" }, callback_phone: { type: "string" } },
      required: ["message"],
      additionalProperties: false,
    },
  },
];

// ---------------------------------------------------------------------------

const localeOf = (l: ConversationLanguage): Locale => (l === "arabizi" ? "ar" : l);
/** Service names: Arabizi texters use English terms ("checkup", "cleaning"), not Arabic script. */
const nameLocaleOf = (l: ConversationLanguage): Locale => (l === "arabizi" ? "en" : l);

function toLocalStart(iso: string | Date, tz: string): string {
  const dt = typeof iso === "string" ? DateTime.fromISO(iso) : DateTime.fromJSDate(iso);
  return dt.setZone(tz).toFormat("yyyy-MM-dd'T'HH:mm");
}

function fromLocalStart(local: string, tz: string): Date {
  return DateTime.fromISO(local, { zone: tz }).toJSDate();
}

async function staffNames(ctx: ToolContext): Promise<Map<string, string>> {
  const s = await listStaff(ctx.tx, ctx.business.id);
  return new Map(s.map((x) => [x.id, x.name]));
}

function priceLabel(cents: number | null, from: boolean, locale: Locale): string {
  if (cents === null) return locale === "ar" ? "السعر عند الطلب" : locale === "fr" ? "prix sur demande" : "price on request";
  return formatPrice(cents, { from, locale });
}

async function ownedAppointment(ctx: ToolContext, appointmentId: string) {
  const appt = await getAppointmentView(ctx.tx, ctx.business.id, appointmentId);
  if (!appt) return null;
  const verifiedOwner = ctx.verifiedPhone && appt.customerPhone === ctx.verifiedPhone;
  const createdHere = (ctx.state.createdAppointmentIds ?? []).includes(appointmentId);
  return verifiedOwner || createdHere ? appt : null;
}

type Handler = (ctx: ToolContext, input: never) => Promise<unknown>;

const handlers: Record<ToolName, Handler> = {
  async get_business_info(ctx) {
    const b = ctx.business;
    const locale = localeOf(ctx.language);
    const hours = await getWeeklyHours(ctx.tx, b.id, null);
    const brks = await getBreaks(ctx.tx, b.id, null);
    const names = ctx.language === "arabizi"
      ? ["Tanen", "Talata", "Arb3a", "Khamis", "Jem3a", "Sabet", "A7ad"]
      : locale === "ar"
      ? ["الاثنين", "الثلاثاء", "الأربعاء", "الخميس", "الجمعة", "السبت", "الأحد"]
      : locale === "fr"
        ? ["lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi", "dimanche"]
        : ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
    const opening = [1, 2, 3, 4, 5, 6, 7].map((d) => {
      const rules = hours.filter((h) => h.weekday === d);
      // In Arabic script "09:00–18:00" is reordered by bidi; "09:00 لـ 18:00" reads correctly right-to-left.
      const range = (r: { start: string; end: string }) => (ctx.language === "ar" ? `${r.start} لـ ${r.end}` : `${r.start}–${r.end}`);
      return { day: names[d - 1], hours: rules.length ? rules.map(range).join("، ") : "closed" };
    });
    const today = DateTime.fromJSDate(ctx.now).setZone(b.timezone).toISODate()!;
    const closures = await ctx.tx
      .select({ startDate: holidays.startDate, endDate: holidays.endDate, name: holidays.name })
      .from(holidays)
      .where(and(eq(holidays.businessId, b.id), gte(holidays.endDate, today)))
      .limit(5);
    const settings = bookingSettings(b);
    return {
      name: b.name,
      address: [b.address, b.city].filter(Boolean).join(", ") || null,
      phone: b.phone,
      whatsapp: b.whatsappNumber,
      maps_url: b.mapsUrl,
      opening_hours: opening,
      breaks: brks.map((r) => ({ day: names[r.weekday - 1], time: `${r.start}–${r.end}` })),
      upcoming_closures: closures.filter((c) => c.startDate <= DateTime.fromISO(today).plus({ days: 45 }).toISODate()!),
      policies: pickLocalized(settings.policies, locale) || null,
      cancellation_notice_hours: settings.cancellationNoticeHours,
      extra_info: b.aiSettings?.extraInstructions ?? null,
    };
  },

  async list_services(ctx) {
    const locale = localeOf(ctx.language);
    const [svc, links, names] = await Promise.all([
      listServices(ctx.tx, ctx.business.id, { activeOnly: true, onlineOnly: true }),
      getStaffServiceLinks(ctx.tx, ctx.business.id),
      staffNames(ctx),
    ]);
    return {
      currency: "USD",
      services: svc.map((s) => ({
        service_id: s.id,
        name: pickLocalized(s.name, nameLocaleOf(ctx.language)),
        duration_minutes: s.durationMinutes,
        price: priceLabel(s.priceCents, s.priceFrom, locale),
        deposit: s.depositRequired ? formatPrice(s.depositCents) : null,
        staff: links.filter((l) => l.serviceId === s.id).map((l) => names.get(l.staffId)).filter(Boolean),
      })),
    };
  },

  async check_availability(ctx, input: z.infer<typeof schemas.check_availability>) {
    const tz = ctx.business.timezone;
    const now = DateTime.fromJSDate(ctx.now).setZone(tz);
    const names = await staffNames(ctx);
    const services = await listServices(ctx.tx, ctx.business.id, { activeOnly: true });
    const svc = services.find((s) => s.id === input.service_id);
    if (!svc) return { error: "unknown_service_id", hint: "Call list_services to get valid service_id values." };

    const filterPart = (start: DateTime) => {
      const h = start.hour;
      switch (input.part_of_day) {
        case "morning":
          return h < 12;
        case "afternoon":
          return h >= 12 && h < 17;
        case "evening":
          return h >= 17;
        default:
          return true;
      }
    };
    const pick = (slots: { start: string; staffIds: string[] }[]) => {
      let list = slots.map((s) => ({ dt: DateTime.fromISO(s.start).setZone(tz), staffId: s.staffIds[0]! })).filter((s) => filterPart(s.dt));
      if (input.preferred_time) {
        const [ph, pm] = input.preferred_time.split(":").map(Number);
        const target = ph! * 60 + pm!;
        list = list.sort((a, b) => Math.abs(a.dt.hour * 60 + a.dt.minute - target) - Math.abs(b.dt.hour * 60 + b.dt.minute - target)).slice(0, 4);
        list.sort((a, b) => a.dt.toMillis() - b.dt.toMillis());
      } else {
        // Spread suggestions across the day instead of six consecutive quarter-hours.
        const spaced: typeof list = [];
        for (const s of list) {
          if (!spaced.length || s.dt.diff(spaced.at(-1)!.dt, "minutes").minutes >= 45) spaced.push(s);
          if (spaced.length >= 6) break;
        }
        list = spaced;
      }
      return list;
    };

    const fromDate = input.date ?? now.toISODate()!;
    const daySlots = await getAvailableSlots(ctx.tx, ctx.business.id, {
      serviceId: svc.id,
      staffId: input.staff_id ?? null,
      fromDate,
      toDate: fromDate,
      channel: "public",
      now: ctx.now,
    });
    let chosen = pick(daySlots);
    let date = fromDate;
    let requestedDateFull = false;
    if (!chosen.length) {
      requestedDateFull = !!input.date;
      const end = DateTime.fromISO(fromDate).plus({ days: 21 }).toISODate()!;
      const ahead = await getAvailableSlots(ctx.tx, ctx.business.id, {
        serviceId: svc.id,
        staffId: input.staff_id ?? null,
        fromDate: DateTime.fromISO(fromDate).plus({ days: 1 }).toISODate()!,
        toDate: end,
        channel: "public",
        now: ctx.now,
      });
      const firstDay = ahead.map((s) => DateTime.fromISO(s.start).setZone(tz)).find((dt) => filterPart(dt))?.toISODate();
      if (firstDay) {
        date = firstDay;
        chosen = pick(ahead.filter((s) => DateTime.fromISO(s.start).setZone(tz).toISODate() === firstDay));
      }
    }
    const slots = chosen.map((s, i) => ({
      option: i + 1,
      start: s.dt.toFormat("yyyy-MM-dd'T'HH:mm"),
      when: spokenDateTime(s.dt.toJSDate(), tz, ctx.language, ctx.now),
      staff_id: s.staffId,
      staff_name: names.get(s.staffId) ?? "",
    }));
    const serviceName = pickLocalized(svc.name, nameLocaleOf(ctx.language));
    ctx.state.offer = {
      serviceId: svc.id,
      serviceName,
      staffId: input.staff_id ?? null,
      slots: slots.map((s) => ({ start: s.start, staffId: s.staff_id, staffName: s.staff_name })),
      at: ctx.now.toISOString(),
    };
    ctx.state.serviceId = svc.id;
    return {
      service: serviceName,
      requested_date: input.date ?? null,
      requested_date_full: requestedDateFull,
      date_shown: slots.length ? date : null,
      slots,
      note: slots.length ? "Offer these options (numbered). Times are business-local." : "No availability in the next 3 weeks for these criteria.",
    };
  },

  async create_booking(ctx, input: z.infer<typeof schemas.create_booking>) {
    const tz = ctx.business.timezone;
    let phone = ctx.verifiedPhone;
    if (!phone) {
      phone = input.customer_phone ? normalizePhone(input.customer_phone) : (ctx.state.claimedPhone ?? null);
      if (!phone) return { ok: false, error: "need_phone", hint: "Ask the customer for their mobile (WhatsApp) number." };
      ctx.state.claimedPhone = phone;
    }
    const name = input.customer_name ?? ctx.customerName ?? ctx.state.customerName ?? null;
    if (!name) return { ok: false, error: "need_name", hint: "Ask for the customer's full name, then call create_booking again." };
    try {
      const appt = await createBooking(ctx.tx, ctx.business.id, {
        serviceId: input.service_id,
        staffId: input.staff_id ?? null,
        startsAt: fromLocalStart(input.start, tz),
        customer: { phone, name, language: localeOf(ctx.language) },
        notes: input.notes ?? null,
        source: ctx.channel === "voice" ? "voice" : ctx.channel === "web_chat" ? "web_chat" : "whatsapp",
        actor: { type: "ai", label: `${ctx.channel} agent` },
        conversationId: ctx.conversationId,
        now: ctx.now,
      });
      const view = await getAppointmentView(ctx.tx, ctx.business.id, appt.id);
      ctx.effects.bookedAppointmentIds.push(appt.id);
      ctx.effects.customerId = appt.customerId;
      ctx.state.createdAppointmentIds = [...(ctx.state.createdAppointmentIds ?? []), appt.id];
      ctx.state.offer = undefined;
      ctx.state.pendingSlot = undefined;
      ctx.state.intent = null;
      ctx.state.customerName = name;
      return {
        ok: true,
        appointment_id: appt.id,
        status: appt.status,
        service: pickLocalized(view!.serviceName, nameLocaleOf(ctx.language)),
        start: toLocalStart(appt.startsAt, tz),
        when: spokenDateTime(appt.startsAt, tz, ctx.language, ctx.now),
        staff_name: view!.staffName,
        ...(appt.depositStatus === "required"
          ? {
              deposit_required: true,
              deposit: formatPrice(appt.depositCents),
              deposit_due: appt.depositDueAt ? spokenDateTime(appt.depositDueAt, tz, ctx.language, ctx.now) : null,
              note: "NOT confirmed yet: the slot is held until the deposit is paid. Payment details are sent on WhatsApp automatically. Tell the customer the amount and the deadline.",
            }
          : { note: appt.status === "pending" ? "Booked as a request: the team will confirm it." : "Confirmed. A WhatsApp confirmation is sent automatically." }),
      };
    } catch (e) {
      if (isDomainError(e) && e.code === "SLOT_UNAVAILABLE") {
        return { ok: false, error: "slot_unavailable", reason: e.details?.reason ?? "conflict", hint: "Call check_availability again and offer other times." };
      }
      if (isDomainError(e)) return { ok: false, error: e.code.toLowerCase(), message: e.message };
      throw e;
    }
  },

  async find_customer_appointments(ctx) {
    const tz = ctx.business.timezone;
    let list: Awaited<ReturnType<typeof findCustomerAppointments>> = [];
    if (ctx.verifiedPhone) {
      list = await findCustomerAppointments(ctx.tx, ctx.business.id, ctx.verifiedPhone, { now: ctx.now });
    } else {
      for (const id of ctx.state.createdAppointmentIds ?? []) {
        const a = await getAppointmentView(ctx.tx, ctx.business.id, id);
        if (a && (a.status === "pending" || a.status === "confirmed") && a.startsAt > ctx.now) list.push(a);
      }
    }
    const locale = nameLocaleOf(ctx.language);
    const out = list.map((a, i) => ({
      option: i + 1,
      appointment_id: a.id,
      service_id: a.serviceId,
      service: pickLocalized(a.serviceName, locale),
      start: toLocalStart(a.startsAt, tz),
      when: spokenDateTime(a.startsAt, tz, ctx.language, ctx.now),
      staff_name: a.staffName,
      status: a.status,
    }));
    ctx.state.appointments = out.map((a) => ({ id: a.appointment_id, start: a.start, serviceName: a.service, staffName: a.staff_name, serviceId: a.service_id }));
    if (out.length === 1) ctx.state.focusAppointmentId = out[0]!.appointment_id;
    return {
      appointments: out,
      note: ctx.verifiedPhone
        ? out.length
          ? undefined
          : "No upcoming appointments for this phone number."
        : "Web chat: only appointments booked in this chat can be managed here. For others, use the link in the WhatsApp confirmation or call the clinic.",
    };
  },

  async reschedule_booking(ctx, input: z.infer<typeof schemas.reschedule_booking>) {
    const tz = ctx.business.timezone;
    const appt = await ownedAppointment(ctx, input.appointment_id);
    if (!appt) return { ok: false, error: "not_found", hint: "Use find_customer_appointments to get this customer's appointment_id." };
    try {
      const updated = await rescheduleBooking(ctx.tx, ctx.business.id, appt.id, {
        startsAt: fromLocalStart(input.new_start, tz),
        staffId: input.staff_id ?? null,
        actor: { type: "ai", label: `${ctx.channel} agent` },
        now: ctx.now,
      });
      ctx.effects.rescheduledAppointmentIds.push(updated.id);
      ctx.state.offer = undefined;
      ctx.state.intent = null;
      return { ok: true, appointment_id: updated.id, start: toLocalStart(updated.startsAt, tz), when: spokenDateTime(updated.startsAt, tz, ctx.language, ctx.now) };
    } catch (e) {
      if (isDomainError(e)) {
        return {
          ok: false,
          error: e.code.toLowerCase(),
          reason: e.details?.reason ?? null,
          hint: e.code === "TOO_LATE" ? `Too close to the appointment to change it (policy: ${e.details?.hours}h). Offer to take a message or hand off to staff.` : "Check availability again.",
        };
      }
      throw e;
    }
  },

  async cancel_booking(ctx, input: z.infer<typeof schemas.cancel_booking>) {
    const tz = ctx.business.timezone;
    const appt = await ownedAppointment(ctx, input.appointment_id);
    if (!appt) return { ok: false, error: "not_found", hint: "Use find_customer_appointments to get this customer's appointment_id." };
    try {
      await cancelBooking(ctx.tx, ctx.business.id, appt.id, {
        actor: { type: "ai", label: `${ctx.channel} agent` },
        reason: input.reason ?? "Cancelled by customer via AI receptionist",
        now: ctx.now,
        business: ctx.business,
      });
      ctx.effects.cancelledAppointmentIds.push(appt.id);
      ctx.state.intent = null;
      ctx.state.focusAppointmentId = null;
      return { ok: true, cancelled: { appointment_id: appt.id, when: spokenDateTime(appt.startsAt, tz, ctx.language, ctx.now) } };
    } catch (e) {
      if (isDomainError(e)) {
        return { ok: false, error: e.code.toLowerCase(), hint: e.code === "TOO_LATE" ? "Too late to cancel online; offer to take a message or hand off." : e.message };
      }
      throw e;
    }
  },

  async handoff_to_human(ctx, input: z.infer<typeof schemas.handoff_to_human>) {
    ctx.effects.handoff = { reason: input.reason, urgency: input.urgency ?? "normal" };
    return { ok: true, note: "A staff member will take over this conversation. Tell the customer someone from the team will reply shortly." };
  },

  async take_message(ctx, input: z.infer<typeof schemas.take_message>) {
    ctx.effects.messageTaken = {
      message: input.message,
      callbackRequested: input.callback_requested ?? false,
      callbackPhone: input.callback_phone ? normalizePhone(input.callback_phone) : ctx.verifiedPhone,
    };
    return { ok: true, note: "Message saved for the team." };
  },
};

export async function executeTool(ctx: ToolContext, name: string, rawInput: unknown): Promise<{ content: string; isError: boolean; output: unknown }> {
  const schema = schemas[name as ToolName];
  if (!schema) return { content: JSON.stringify({ error: `unknown tool ${name}` }), isError: true, output: null };
  const parsed = schema.safeParse(rawInput ?? {});
  if (!parsed.success) {
    const err = { error: "invalid_input", issues: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`) };
    return { content: JSON.stringify(err), isError: true, output: err };
  }
  const output = await handlers[name as ToolName](ctx, parsed.data as never);
  return { content: JSON.stringify(output), isError: false, output };
}

/** Exposed for tests. */
export const _internal = { toLocalStart, fromLocalStart, ownedAppointment, appointmentsTable: appointments };
