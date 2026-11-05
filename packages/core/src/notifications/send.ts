/**
 * Appointment notification job handler (confirmation, reminders, reschedule,
 * cancel, deposit request). Renders the WhatsApp template in the customer's
 * language and sends it through `sendCustomerTemplate`.
 */
import { DateTime } from "luxon";
import { withTenant } from "../db/tenant";
import type { Job, Locale } from "../db/schema";
import { getAppointmentView, type NotificationKind } from "../booking/service";
import { bookingUrl, manageUrl } from "../booking/tokens";
import { depositInstructions, depositReference, pendingDepositPayment } from "../booking/deposit-rules";
import { pickLocalized } from "../lib/i18n";
import { formatDateTime, formatPrice, formatTime } from "../lib/time";
import type { TemplateName } from "./templates";
import { sendCustomerTemplate } from "./customer";

const NAME_FALLBACK: Record<Locale, string> = { ar: "", en: "there", fr: "" };

function templateFor(kind: NotificationKind, askConfirmation: boolean): TemplateName {
  switch (kind) {
    case "confirmation":
      return "appointment_confirmation";
    case "pending":
      return "appointment_pending";
    case "reminder":
      return askConfirmation ? "appointment_reminder_confirm" : "appointment_reminder";
    case "rescheduled":
      return "appointment_rescheduled";
    case "cancelled":
      return "appointment_cancelled";
    case "deposit_request":
      return "deposit_request";
  }
}

const PAY_BY: Record<Locale, (t: string) => string> = {
  ar: (t) => `بليز ادفع قبل ${t} وإلا بينلغى الحجز. الرقم المرجعي:`,
  en: (t) => `Please pay before ${t}, otherwise the slot is released. Reference:`,
  fr: (t) => `Merci de payer avant ${t}, sinon le créneau sera libéré. Référence :`,
};

export async function handleAppointmentNotification(job: Job): Promise<void | { skipped: string }> {
  const payload = job.payload as { appointmentId: string; kind: NotificationKind; expectedStartsAt?: string; askConfirmation?: boolean };
  const businessId = job.businessId;
  if (!businessId) return { skipped: "no business" };

  const appt = await withTenant(businessId, (tx) => getAppointmentView(tx, businessId, payload.appointmentId));
  if (!appt) return { skipped: "appointment not found" };
  if (payload.kind !== "cancelled") {
    if (appt.status === "cancelled") return { skipped: "appointment cancelled" };
    if (payload.expectedStartsAt && appt.startsAt.toISOString() !== payload.expectedStartsAt) return { skipped: "appointment moved" };
    if (appt.startsAt.getTime() < Date.now()) return { skipped: "appointment in the past" };
  }
  if (payload.kind === "deposit_request" && appt.depositStatus !== "required") return { skipped: "deposit no longer required" };
  const payment = payload.kind === "deposit_request" ? await withTenant(businessId, (tx) => pendingDepositPayment(tx, appt.id)) : null;

  const template = templateFor(payload.kind, !!payload.askConfirmation);
  const res = await sendCustomerTemplate({
    businessId,
    customerId: appt.customerId,
    appointmentId: appt.id,
    template,
    variables: ({ locale, business, customer }) => {
      const name = customer.name?.split(" ")[0] ?? NAME_FALLBACK[locale];
      const service = pickLocalized(appt.serviceName, locale);
      const when = formatDateTime(appt.startsAt, business.timezone, locale);
      if (template === "deposit_request") {
        const due = appt.depositDueAt ?? appt.startsAt;
        const dueText = DateTime.fromJSDate(due).hasSame(DateTime.now(), "day")
          ? formatTime(due, business.timezone, locale)
          : formatDateTime(due, business.timezone, locale);
        const how = payment?.paymentUrl ?? depositInstructions(business, locale);
        return [name, formatPrice(appt.depositCents), service, when, `${how} ${PAY_BY[locale](dueText)} ${depositReference(appt.id)}`];
      }
      const link = payload.kind === "cancelled" ? bookingUrl(business.slug) : manageUrl(business.slug, appt.id);
      return [name, service, business.name, when, link];
    },
  });
  if (res.status === "skipped") return { skipped: res.reason ?? "skipped" };
}
