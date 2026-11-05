/**
 * Appointment notification job handler (confirmation, reminders, reschedule,
 * cancel). Renders the WhatsApp template in the customer's language and sends
 * it through the WhatsApp provider, recording everything in `notifications`.
 */
import { and, eq } from "drizzle-orm";
import { withTenant } from "../db/tenant";
import { customers, notifications, type Job, type Locale } from "../db/schema";
import { getAppointmentView, type NotificationKind } from "../booking/service";
import { getBusiness } from "../availability/loader";
import { bookingUrl, manageUrl } from "../booking/tokens";
import { pickLocalized } from "../lib/i18n";
import { formatDateTime } from "../lib/time";
import { recordUsage } from "../lib/usage";
import { getWhatsAppProvider } from "../providers";
import { renderTemplate, type TemplateName } from "./templates";
import { afterOutboundWhatsApp } from "./hooks";

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
  }
}

export async function handleAppointmentNotification(job: Job): Promise<void | { skipped: string }> {
  const payload = job.payload as {
    appointmentId: string;
    kind: NotificationKind;
    expectedStartsAt?: string;
    askConfirmation?: boolean;
  };
  const businessId = job.businessId;
  if (!businessId) return { skipped: "no business" };

  const prepared = await withTenant(businessId, async (tx) => {
    const appt = await getAppointmentView(tx, businessId, payload.appointmentId);
    if (!appt) return { skip: "appointment not found" } as const;
    if (payload.kind !== "cancelled") {
      if (appt.status === "cancelled") return { skip: "appointment cancelled" } as const;
      if (payload.expectedStartsAt && appt.startsAt.toISOString() !== payload.expectedStartsAt) {
        return { skip: "appointment moved" } as const;
      }
      if (appt.startsAt.getTime() < Date.now()) return { skip: "appointment in the past" } as const;
    }
    const business = await getBusiness(tx, businessId);
    const [customer] = await tx
      .select()
      .from(customers)
      .where(and(eq(customers.id, appt.customerId), eq(customers.businessId, businessId)));
    if (!customer) return { skip: "customer missing" } as const;

    const locale: Locale = customer.preferredLanguage ?? business.defaultLanguage;
    const template = templateFor(payload.kind, !!payload.askConfirmation);
    const link = payload.kind === "cancelled" ? bookingUrl(business.slug) : manageUrl(business.slug, appt.id);
    const variables = [
      customer.name?.split(" ")[0] ?? NAME_FALLBACK[locale],
      pickLocalized(appt.serviceName, locale),
      business.name,
      formatDateTime(appt.startsAt, business.timezone, locale),
      link,
    ];
    const body = renderTemplate(template, locale, variables);
    const optedOut = !customer.consentWhatsapp || !!customer.optedOutAt;
    const [row] = await tx
      .insert(notifications)
      .values({
        businessId,
        customerId: customer.id,
        appointmentId: appt.id,
        channel: "whatsapp",
        toAddress: customer.phone,
        templateName: template,
        language: locale,
        variables,
        body,
        status: optedOut ? "skipped" : "queued",
        error: optedOut ? "customer opted out of WhatsApp" : null,
      })
      .returning({ id: notifications.id });
    if (optedOut) return { skip: "customer opted out" } as const;
    return {
      notificationId: row!.id,
      to: customer.phone,
      customerId: customer.id,
      template,
      locale,
      variables,
      body,
      phoneNumberId: business.whatsappPhoneNumberId,
      timezone: business.timezone,
    };
  });

  if ("skip" in prepared) return { skipped: prepared.skip ?? "skipped" };

  const provider = getWhatsAppProvider();
  try {
    const res = await provider.sendTemplate({
      phoneNumberId: prepared.phoneNumberId,
      to: prepared.to,
      template: prepared.template,
      locale: prepared.locale,
      variables: prepared.variables,
      renderedBody: prepared.body,
    });
    await withTenant(businessId, async (tx) => {
      await tx
        .update(notifications)
        .set({ status: "sent", providerMessageId: res.providerMessageId, sentAt: new Date() })
        .where(eq(notifications.id, prepared.notificationId));
      await recordUsage(tx, businessId, "whatsapp_template", 1, { timezone: prepared.timezone, metadata: { template: prepared.template } });
      await afterOutboundWhatsApp(tx, {
        businessId,
        customerId: prepared.customerId,
        phone: prepared.to,
        body: prepared.body,
        providerMessageId: res.providerMessageId,
        contentType: "template",
      });
    });
  } catch (err) {
    await withTenant(businessId, (tx) =>
      tx
        .update(notifications)
        .set({ status: "failed", error: err instanceof Error ? err.message : String(err) })
        .where(eq(notifications.id, prepared.notificationId)),
    );
    throw err;
  }
}
