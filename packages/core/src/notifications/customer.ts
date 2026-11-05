/**
 * Send a WhatsApp template to one customer: consent checks, render in the
 * customer's language, record in `notifications`, send, mirror into the
 * customer's conversation and meter usage. Used by appointment notifications,
 * deposits, review requests, recalls and campaigns.
 */
import { and, eq } from "drizzle-orm";
import { withTenant } from "../db/tenant";
import { customers, notifications, type Business, type Customer, type Locale } from "../db/schema";
import { getBusiness } from "../availability/loader";
import { recordUsage } from "../lib/usage";
import { getWhatsAppProvider } from "../providers";
import { renderTemplate, TEMPLATES, type TemplateName } from "./templates";
import { afterOutboundWhatsApp } from "./hooks";

export type SendResult = { status: "sent" | "skipped" | "failed"; reason?: string; notificationId?: string; body?: string };

export async function sendCustomerTemplate(input: {
  businessId: string;
  customerId: string;
  template: TemplateName;
  /** Built once the customer's language is known. */
  variables: (ctx: { locale: Locale; business: Business; customer: Customer }) => string[] | Promise<string[]>;
  appointmentId?: string | null;
  campaignId?: string | null;
}): Promise<SendResult> {
  const { businessId } = input;
  const marketing = TEMPLATES[input.template].category === "MARKETING";
  const prepared = await withTenant(businessId, async (tx) => {
    const business = await getBusiness(tx, businessId);
    const [customer] = await tx
      .select()
      .from(customers)
      .where(and(eq(customers.id, input.customerId), eq(customers.businessId, businessId)));
    if (!customer) return { skip: "customer missing" } as const;
    const locale: Locale = customer.preferredLanguage ?? business.defaultLanguage;
    const variables = await input.variables({ locale, business, customer });
    const body = renderTemplate(input.template, locale, variables);
    const optedOut = !customer.consentWhatsapp || !!customer.optedOutAt;
    const noMarketing = marketing && !customer.consentMarketing;
    const skipReason = optedOut ? "customer opted out of WhatsApp" : noMarketing ? "no marketing consent" : null;
    const rows = await tx
      .insert(notifications)
      .values({
        businessId,
        customerId: customer.id,
        appointmentId: input.appointmentId ?? null,
        campaignId: input.campaignId ?? null,
        channel: "whatsapp",
        toAddress: customer.phone,
        templateName: input.template,
        language: locale,
        variables,
        body,
        status: skipReason ? "skipped" : "queued",
        error: skipReason,
      })
      .onConflictDoNothing()
      .returning({ id: notifications.id });
    if (!rows.length) return { skip: "already sent" } as const;
    if (skipReason) return { skip: skipReason, notificationId: rows[0]!.id } as const;
    return { notificationId: rows[0]!.id, customer, locale, variables, body, business };
  });
  if ("skip" in prepared) return { status: "skipped", reason: prepared.skip, notificationId: prepared.notificationId };

  try {
    const res = await getWhatsAppProvider().sendTemplate({
      phoneNumberId: prepared.business.whatsappPhoneNumberId,
      to: prepared.customer.phone,
      template: input.template,
      locale: prepared.locale,
      variables: prepared.variables,
      renderedBody: prepared.body,
    });
    await withTenant(businessId, async (tx) => {
      await tx
        .update(notifications)
        .set({ status: "sent", providerMessageId: res.providerMessageId, sentAt: new Date() })
        .where(eq(notifications.id, prepared.notificationId));
      await recordUsage(tx, businessId, "whatsapp_template", 1, { timezone: prepared.business.timezone, metadata: { template: input.template } });
      await afterOutboundWhatsApp(tx, {
        businessId,
        customerId: prepared.customer.id,
        phone: prepared.customer.phone,
        body: prepared.body,
        providerMessageId: res.providerMessageId,
        contentType: "template",
      });
    });
    return { status: "sent", notificationId: prepared.notificationId, body: prepared.body };
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
