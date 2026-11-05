/**
 * Hooks run after an outbound WhatsApp message is sent outside a conversation
 * flow (templates, reminders). Phase 2 uses this to mirror the message into the
 * customer's WhatsApp conversation so the inbox shows the full thread.
 */
import type { Tx } from "../db/tenant";

export type OutboundWhatsAppEvent = {
  businessId: string;
  customerId: string;
  phone: string;
  body: string;
  providerMessageId: string;
  contentType: "template" | "text";
};

type Hook = (tx: Tx, e: OutboundWhatsAppEvent) => Promise<void>;
const hooks: Hook[] = [];

export function onOutboundWhatsApp(hook: Hook): void {
  if (!hooks.includes(hook)) hooks.push(hook);
}

export async function afterOutboundWhatsApp(tx: Tx, e: OutboundWhatsAppEvent): Promise<void> {
  for (const h of hooks) await h(tx, e);
}
