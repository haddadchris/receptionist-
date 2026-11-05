import { randomUUID } from "node:crypto";
import { logger } from "../../lib/logger";
import type { InboundWhatsAppEvent, SendResult, WhatsAppProvider } from "./types";

export type MockOutbound = { id: string; to: string; body: string; template?: string; at: Date };

/**
 * Mock WhatsApp provider for local development: logs to the console and keeps
 * an in-memory outbox (the DB `notifications` / `messages` rows are the
 * durable record and what the dashboard shows). Inbound messages are injected
 * through the dashboard's WhatsApp simulator, which posts a Meta-shaped payload
 * to the same webhook handler.
 */
export class MockWhatsAppProvider implements WhatsAppProvider {
  readonly name = "mock";
  readonly outbox: MockOutbound[] = [];

  async sendText(input: { to: string; body: string }): Promise<SendResult> {
    const id = `mock-wamid-${randomUUID()}`;
    this.outbox.push({ id, to: input.to, body: input.body, at: new Date() });
    logger.info("[whatsapp:mock] text", { to: input.to, body: input.body });
    return { providerMessageId: id };
  }

  async sendTemplate(input: { to: string; template: string; renderedBody: string }): Promise<SendResult> {
    const id = `mock-wamid-${randomUUID()}`;
    this.outbox.push({ id, to: input.to, body: input.renderedBody, template: input.template, at: new Date() });
    logger.info("[whatsapp:mock] template", { to: input.to, template: input.template, body: input.renderedBody });
    return { providerMessageId: id };
  }

  verifySignature(): boolean {
    return true;
  }

  parseWebhook(body: unknown): InboundWhatsAppEvent[] {
    // The mock accepts the same payload shape as Meta (see meta.ts).
    return parseMetaWebhook(body);
  }

  async downloadMedia(): Promise<{ data: Buffer; mimeType: string }> {
    return { data: Buffer.alloc(0), mimeType: "audio/ogg" };
  }
}

type MetaPayload = {
  entry?: {
    changes?: {
      value?: {
        metadata?: { phone_number_id?: string };
        contacts?: { wa_id?: string; profile?: { name?: string } }[];
        messages?: {
          id: string;
          from: string;
          timestamp?: string;
          type: string;
          text?: { body?: string };
          audio?: { id?: string; mime_type?: string };
          voice?: { id?: string; mime_type?: string };
          image?: { id?: string; mime_type?: string; caption?: string };
          button?: { text?: string; payload?: string };
          interactive?: { button_reply?: { title?: string; id?: string }; list_reply?: { title?: string; id?: string } };
        }[];
        statuses?: { id: string; status: string; errors?: { title?: string; message?: string }[] }[];
      };
    }[];
  }[];
};

/** Parse a WhatsApp Cloud API webhook payload into normalized events. */
export function parseMetaWebhook(body: unknown): InboundWhatsAppEvent[] {
  const events: InboundWhatsAppEvent[] = [];
  const payload = body as MetaPayload;
  for (const entry of payload?.entry ?? []) {
    for (const change of entry.changes ?? []) {
      const value = change.value;
      if (!value) continue;
      const phoneNumberId = value.metadata?.phone_number_id ?? "";
      const profileName = value.contacts?.[0]?.profile?.name;
      for (const m of value.messages ?? []) {
        const base = {
          kind: "message" as const,
          phoneNumberId,
          from: m.from.startsWith("+") ? m.from : `+${m.from}`,
          profileName,
          providerMessageId: m.id,
          timestamp: m.timestamp ? new Date(Number(m.timestamp) * 1000) : new Date(),
        };
        switch (m.type) {
          case "text":
            events.push({ ...base, type: "text", text: m.text?.body ?? "" });
            break;
          case "audio":
          case "voice": {
            const media = m.audio ?? m.voice;
            events.push({ ...base, type: "audio", mediaId: media?.id, mimeType: media?.mime_type });
            break;
          }
          case "image":
            events.push({ ...base, type: "image", mediaId: m.image?.id, text: m.image?.caption });
            break;
          case "button":
            events.push({ ...base, type: "button", text: m.button?.text ?? m.button?.payload ?? "" });
            break;
          case "interactive":
            events.push({
              ...base,
              type: "interactive",
              text: m.interactive?.button_reply?.title ?? m.interactive?.list_reply?.title ?? "",
            });
            break;
          case "location":
            events.push({ ...base, type: "location" });
            break;
          default:
            events.push({ ...base, type: "other" });
        }
      }
      for (const s of value.statuses ?? []) {
        if (!["sent", "delivered", "read", "failed"].includes(s.status)) continue;
        events.push({
          kind: "status",
          phoneNumberId,
          providerMessageId: s.id,
          status: s.status as "sent" | "delivered" | "read" | "failed",
          error: s.errors?.[0]?.message ?? s.errors?.[0]?.title,
        });
      }
    }
  }
  return events;
}
