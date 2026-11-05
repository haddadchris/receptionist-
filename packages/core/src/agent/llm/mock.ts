/**
 * MockLLMProvider — a deterministic, rule-based stand-in for a real LLM.
 *
 * It reads the conversation, decides which tool to call (using the same tools
 * and the same validation as real models), and writes replies from templates in
 * Lebanese Arabic / Arabizi / English / French. This lets the whole product run
 * locally and in CI without API keys. It is intentionally simpler than a real
 * model; evals report which provider they ran against.
 */
import { DateTime } from "luxon";
import type { LLMProvider, LLMRequest, LLMResponse, ToolCall, ToolResult } from "./types";
import { matchService, parseCatalog, parseDate, parseFlags, parseName, parseOption, parsePartOfDay, parseTime, type Flags } from "./nlu";
import { R } from "./mock-replies";
import { spokenDateTime } from "../../lib/spoken";

let seq = 0;
const call = (name: string, input: Record<string, unknown>): ToolCall => ({ id: `mock_${++seq}`, name, input });

const reply = (text: string): LLMResponse => ({ text, toolCalls: [], stop: "end" });
const tool = (name: string, input: Record<string, unknown>): LLMResponse => ({ text: "", toolCalls: [call(name, input)], stop: "tool_use" });

type AvailabilityOut = {
  service: string;
  requested_date_full: boolean;
  slots: { option: number; start: string; when: string; staff_id: string; staff_name: string }[];
};

export class MockLLMProvider implements LLMProvider {
  readonly name = "mock";

  async complete(req: LLMRequest): Promise<LLMResponse> {
    const res = this.decide(req);
    if (res.text) req.onText?.(res.text);
    return { ...res, usage: { inputTokens: 0, outputTokens: 0 }, model: "mock" };
  }

  private lastUserText(req: LLMRequest): string {
    for (let i = req.messages.length - 1; i >= 0; i--) {
      const m = req.messages[i]!;
      if (m.role === "user") return m.text;
    }
    return "";
  }

  /** Tool calls already made in this turn (after the last user message). */
  private turnCalls(req: LLMRequest): string[] {
    const names: string[] = [];
    for (let i = req.messages.length - 1; i >= 0; i--) {
      const m = req.messages[i]!;
      if (m.role === "user") break;
      if (m.role === "assistant") for (const c of m.toolCalls ?? []) names.push(c.name);
    }
    return names;
  }

  private decide(req: LLMRequest): LLMResponse {
    const last = req.messages.at(-1);
    if (last?.role === "tool") return this.afterTools(req, last.results);
    return this.onUser(req, this.lastUserText(req));
  }

  private requestedTiming(text: string, now: DateTime) {
    const date = parseDate(text, now);
    const time = parseTime(text);
    const part = parsePartOfDay(text);
    return { date, time, part };
  }

  /** Merge timing from this message with what the customer asked for earlier. */
  private availabilityCall(serviceId: string, text: string, now: DateTime, st?: LLMRequest["context"]["state"], staffId?: string | null) {
    const t = this.requestedTiming(text, now);
    const prev = st?.requested ?? {};
    const date = t.date ?? prev.date ?? null;
    const part = t.part ?? (t.date ? null : (prev.part ?? null));
    const time = t.time ? `${String(t.time.h).padStart(2, "0")}:${String(t.time.m).padStart(2, "0")}` : t.date ? null : (prev.time ?? null);
    if (st) st.requested = { date, part, time };
    const input: Record<string, unknown> = { service_id: serviceId };
    if (date) input.date = date;
    if (part) input.part_of_day = part;
    if (time) input.preferred_time = time;
    if (staffId) input.staff_id = staffId;
    return tool("check_availability", input);
  }

  private rememberTiming(text: string, now: DateTime, st: LLMRequest["context"]["state"]) {
    const t = this.requestedTiming(text, now);
    if (t.date || t.part || t.time) {
      st.requested = {
        date: t.date ?? st.requested?.date ?? null,
        part: t.part ?? null,
        time: t.time ? `${String(t.time.h).padStart(2, "0")}:${String(t.time.m).padStart(2, "0")}` : null,
      };
    }
  }

  private onUser(req: LLMRequest, text: string): LLMResponse {
    const c = req.context;
    const l = c.language;
    const st = c.state;
    const f: Flags = parseFlags(text);
    const now = DateTime.fromISO(c.now).setZone(c.timezone);
    const catalog = parseCatalog(req.systemStable);
    const service = matchService(text, catalog);

    // 1. Safety and escalation.
    if (f.emergency) return tool("handoff_to_human", { reason: `Possible emergency: ${text.slice(0, 200)}`, urgency: "urgent" });
    if (f.complaint || f.human) return tool("handoff_to_human", { reason: f.complaint ? `Complaint: ${text.slice(0, 200)}` : "Customer asked for a person" });
    if (f.injection) return reply(R.injection(l));
    if (f.medical && !f.book) return reply(R.medical(l));

    // 2. Voice: waiting for a yes on details we read back.
    if (st.pendingConfirm) {
      const pc = st.pendingConfirm;
      if (f.yes && !f.no) {
        st.pendingConfirm = undefined;
        if (pc.intent === "reschedule" && st.focusAppointmentId) {
          return tool("reschedule_booking", { appointment_id: st.focusAppointmentId, new_start: pc.start, ...(pc.staffId ? { staff_id: pc.staffId } : {}) });
        }
        return tool("create_booking", { service_id: pc.serviceId, start: pc.start, ...(pc.staffId ? { staff_id: pc.staffId } : {}), ...(pc.name ? { customer_name: pc.name } : {}) });
      }
      if (f.no) {
        st.pendingConfirm = undefined;
        return reply(R.askOtherTime(l));
      }
    }

    // 3. Picking one of the offered times / appointments.
    if (st.pendingSlot) {
      const phone = text.match(/(\+?\d[\d\s-]{6,16}\d)/)?.[1];
      const name = parseName(text.replace(phone ?? "", " ").trim(), true) ?? c.customerName ?? st.customerName ?? null;
      if (phone || name) {
        if (name) st.customerName = name;
        if (c.channel === "voice" && name) {
          const ps = st.pendingSlot;
          st.pendingSlot = undefined;
          return this.confirmVoice(req, { ...ps, intent: "book", name });
        }
        const input: Record<string, unknown> = { service_id: st.pendingSlot.serviceId, start: st.pendingSlot.start };
        if (st.pendingSlot.staffId) input.staff_id = st.pendingSlot.staffId;
        if (name) input.customer_name = name;
        if (phone) input.customer_phone = phone;
        return tool("create_booking", input);
      }
    }
    if (st.intent === "cancel" && st.appointments?.length && !f.book) {
      const opt = parseOption(text, st.appointments.length);
      const target = opt ? st.appointments[opt - 1] : st.appointments.length === 1 && (f.yes || f.cancel) ? st.appointments[0] : undefined;
      if (target) return tool("cancel_booking", { appointment_id: target.id });
    }
    if (st.intent === "reschedule" && st.appointments?.length && !st.focusAppointmentId) {
      const opt = parseOption(text, st.appointments.length);
      if (opt) {
        st.focusAppointmentId = st.appointments[opt - 1]!.id;
        const a = st.appointments[opt - 1]!;
        if (a.serviceId && (parseDate(text, now) || parseTime(text))) return this.availabilityCall(a.serviceId, text, now, st);
        return reply(R.askWhen(l, a.start.replace("T", " ")));
      }
    }
    if (st.offer?.slots.length) {
      const opt = parseOption(text, st.offer.slots.length);
      let chosen = opt ? st.offer.slots[opt - 1] : undefined;
      if (!chosen) {
        const tm = parseTime(text);
        const date = parseDate(text, now);
        if (tm) {
          const hhmm = `${String(tm.h).padStart(2, "0")}:${String(tm.m).padStart(2, "0")}`;
          chosen = st.offer.slots.find((s) => s.start.endsWith(hhmm) && (!date || s.start.startsWith(date)));
        }
      }
      if (chosen) {
        if (st.intent === "reschedule" && st.focusAppointmentId) {
          if (c.channel === "voice") return this.confirmVoice(req, { ...chosen, serviceId: st.offer.serviceId, intent: "reschedule" });
          return tool("reschedule_booking", { appointment_id: st.focusAppointmentId, new_start: chosen.start, staff_id: chosen.staffId });
        }
        const name = c.customerName ?? st.customerName ?? parseName(text, false);
        if (!name) {
          st.pendingSlot = { ...chosen, serviceId: st.offer.serviceId };
          return reply(R.askName(l));
        }
        if (c.channel === "voice") return this.confirmVoice(req, { ...chosen, serviceId: st.offer.serviceId, intent: "book", name });
        return tool("create_booking", { service_id: st.offer.serviceId, start: chosen.start, staff_id: chosen.staffId, customer_name: name });
      }
    }

    // 3. Cancel / reschedule.
    if (f.cancel && !f.reschedule) {
      st.intent = "cancel";
      return tool("find_customer_appointments", {});
    }
    if (f.reschedule) {
      st.intent = "reschedule";
      st.focusAppointmentId = null;
      return tool("find_customer_appointments", {});
    }
    if (st.intent === "reschedule" && st.focusAppointmentId && (parseDate(text, now) || parseTime(text) || parsePartOfDay(text))) {
      const a = st.appointments?.find((x) => x.id === st.focusAppointmentId);
      if (a?.serviceId) return this.availabilityCall(a.serviceId, text, now, st);
    }

    // 4. Questions.
    if (f.price) return tool("list_services", {});
    if (f.hours || f.location) return tool("get_business_info", {});

    // 5. Booking / availability.
    const timing = this.requestedTiming(text, now);
    const mentionsTime = !!(timing.date || timing.time || timing.part);
    if (f.book || f.availability || service || (mentionsTime && st.intent === "book")) {
      st.intent = "book";
      const svcId = service?.id ?? st.serviceId ?? null;
      if (!svcId) {
        st.confusedCount = 0;
        this.rememberTiming(text, now, st);
        return reply(R.askService(l, catalog.map((s) => this.localName(s.names, l))));
      }
      st.serviceId = svcId;
      if (!mentionsTime && !f.availability && !f.book && !st.requested?.date) {
        return reply(R.askWhichDay(l, this.localName(catalog.find((s) => s.id === svcId)?.names ?? [], l)));
      }
      return this.availabilityCall(svcId, text, now, st);
    }

    if (f.greeting) return reply(R.greet(l, c.personaName, c.businessName, c.customerName));
    if (f.thanks) return reply(R.thanks(l));
    if (f.offTopic) return reply(R.offTopic(l));
    if (f.medical) return reply(R.medical(l));

    st.confusedCount = (st.confusedCount ?? 0) + 1;
    if (st.confusedCount >= 2) {
      if (f.yes) return tool("take_message", { message: text, callback_requested: true });
      return reply(R.offerMessage(l));
    }
    return reply(R.confused(l));
  }

  /** Voice: read the details back and wait for a yes. */
  private confirmVoice(req: LLMRequest, pc: NonNullable<LLMRequest["context"]["state"]["pendingConfirm"]>): LLMResponse {
    const c = req.context;
    c.state.pendingConfirm = pc;
    const when = spokenDateTime(DateTime.fromISO(pc.start, { zone: c.timezone }).toJSDate(), c.timezone, c.language, new Date(c.now));
    const service = c.state.offer?.serviceName ?? "";
    return reply(R.confirmVoice(c.language, service, when, pc.staffName, pc.name ?? c.customerName ?? null));
  }

  private localName(names: string[], l: string): string {
    // Catalog order is en | ar | fr (see prompt.ts); pick by script.
    if (l === "ar") return names.find((n) => /[؀-ۿ]/.test(n)) ?? names[0] ?? "";
    if (l === "fr") return names[2] ?? names[0] ?? "";
    return names[0] ?? "";
  }

  private afterTools(req: LLMRequest, results: ToolResult[]): LLMResponse {
    const c = req.context;
    const l = c.language;
    const st = c.state;
    const r = results.at(-1)!;
    const out = JSON.parse(r.content) as Record<string, unknown>;
    const text = this.lastUserText(req);
    const now = DateTime.fromISO(c.now).setZone(c.timezone);
    const calls = this.turnCalls(req);

    switch (r.name) {
      case "check_availability": {
        const a = out as unknown as AvailabilityOut;
        if (!a.slots?.length) return reply(R.noSlots(l, a.service ?? ""));
        const tm = parseTime(text);
        // If the customer named an exact free time and we know who they are, propose it directly.
        if (tm && (st.intent === "book" || st.intent === "reschedule")) {
          const hhmm = `${String(tm.h).padStart(2, "0")}:${String(tm.m).padStart(2, "0")}`;
          const exact = a.slots.find((s) => s.start.endsWith(hhmm));
          if (exact && a.slots.length > 1) {
            a.slots = [exact, ...a.slots.filter((s) => s !== exact)].map((s, i) => ({ ...s, option: i + 1 }));
            st.offer = st.offer ? { ...st.offer, slots: a.slots.map((s) => ({ start: s.start, staffId: s.staff_id, staffName: s.staff_name })) } : st.offer;
          }
        }
        if (c.channel === "voice") {
          const three = a.slots.slice(0, 3);
          if (st.offer) st.offer = { ...st.offer, slots: three.map((s) => ({ start: s.start, staffId: s.staff_id, staffName: s.staff_name })) };
          return reply(R.offerVoice(l, a.service, three.map((s) => s.when), a.requested_date_full));
        }
        return reply(R.offer(l, a.service, a.slots, a.requested_date_full));
      }
      case "create_booking": {
        if (out.ok && out.deposit_required) return reply(R.bookedDeposit(l, String(out.service), String(out.when), String(out.deposit), out.deposit_due ? String(out.deposit_due) : null));
        if (out.ok) return reply(R.booked(l, String(out.service), String(out.when), String(out.staff_name), out.status === "pending"));
        if (out.error === "need_name" || out.error === "need_phone") {
          const lastCall = [...req.messages].reverse().find((m) => m.role === "assistant" && m.toolCalls?.length);
          const inp = (lastCall && lastCall.role === "assistant" ? lastCall.toolCalls![0]!.input : {}) as { service_id?: string; start?: string; staff_id?: string };
          if (inp.service_id && inp.start) st.pendingSlot = { serviceId: inp.service_id, start: inp.start, staffId: inp.staff_id ?? "", staffName: "" };
          return reply(out.error === "need_name" ? R.askName(l) : R.askPhone(l));
        }
        if (out.error === "slot_unavailable" && !calls.includes("check_availability") && st.serviceId) {
          return { text: R.slotTaken(l), toolCalls: [call("check_availability", { service_id: st.serviceId })], stop: "tool_use" };
        }
        return reply(R.slotTaken(l));
      }
      case "find_customer_appointments": {
        const appts = (out.appointments as { appointment_id: string; when: string; service: string; service_id?: string; start: string }[]) ?? [];
        if (!appts.length) return reply(R.noAppointments(l));
        st.appointments = appts.map((x) => ({ id: x.appointment_id, start: x.start, serviceName: x.service, staffName: "", serviceId: x.service_id }));
        const lines = appts.map((x, i) => `${i + 1}. ${x.service} — ${x.when}`);
        if (st.intent === "cancel") {
          const opt = parseOption(text, appts.length);
          if (appts.length === 1) return tool("cancel_booking", { appointment_id: appts[0]!.appointment_id });
          if (opt) return tool("cancel_booking", { appointment_id: appts[opt - 1]!.appointment_id });
          return reply(R.pickAppointment(l, lines));
        }
        if (st.intent === "reschedule") {
          if (appts.length === 1) {
            st.focusAppointmentId = appts[0]!.appointment_id;
            const timing = this.requestedTiming(text, now);
            if ((timing.date || timing.time || timing.part) && appts[0]!.service_id) {
              return this.availabilityCall(appts[0]!.service_id, text, now, st);
            }
            return reply(R.askWhen(l, appts[0]!.when));
          }
          return reply(R.pickAppointment(l, lines));
        }
        return reply(R.pickAppointment(l, lines));
      }
      case "reschedule_booking":
        if (out.ok) return reply(R.rescheduled(l, String(out.when)));
        if (out.error === "too_late") return reply(R.tooLate(l));
        return reply(R.slotTaken(l));
      case "cancel_booking":
        if (out.ok) return reply(R.cancelled(l, String((out.cancelled as { when: string }).when)));
        if (out.error === "too_late") return reply(R.tooLate(l));
        return reply(R.confused(l));
      case "list_services": {
        const services = (out.services as { service_id: string; name: string; price: string }[]) ?? [];
        const catalog = parseCatalog(req.systemStable);
        const m = matchService(text, catalog);
        const s = m ? services.find((x) => x.service_id === m.id) : undefined;
        if (s) {
          st.serviceId = s.service_id;
          st.intent = "book";
          return reply(R.price(l, s.name, s.price));
        }
        return reply(R.priceList(l, services.map((x) => `• ${x.name}: ${x.price}`)));
      }
      case "get_business_info": {
        const f = parseFlags(text);
        if (f.location && !f.hours) return reply(R.location(l, String(out.address ?? ""), (out.maps_url as string) ?? null));
        const hours = (out.opening_hours as { day: string; hours: string }[]).map((h) => `• ${h.day}: ${h.hours === "closed" ? (l === "ar" ? "مسكّر" : l === "arabizi" ? "msakkar" : l === "fr" ? "fermé" : "closed") : h.hours}`);
        return reply(R.hours(l, hours));
      }
      case "handoff_to_human":
        return reply(R.handoff(l, req.messages.some((m) => m.role === "assistant" && m.toolCalls?.some((t) => t.name === "handoff_to_human" && (t.input as { urgency?: string }).urgency === "urgent"))));
      case "take_message":
        return reply(R.messageTaken(l));
      default:
        return reply(R.confused(l));
    }
  }
}
