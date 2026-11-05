/**
 * Meta WhatsApp Cloud API provider.
 *
 * Env: WHATSAPP_ACCESS_TOKEN (system-user token), WHATSAPP_APP_SECRET (for
 * X-Hub-Signature-256), WHATSAPP_PHONE_NUMBER_ID (default sender; each
 * business can override with its own phone_number_id), WHATSAPP_GRAPH_VERSION
 * (default v24.0 — verify against Meta's changelog when going live).
 *
 * Endpoints used: POST /{phone-number-id}/messages (text, template, read
 * receipts), GET /{media-id} then GET <url> for media download.
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import { logger } from "../../lib/logger";
import { META_LANGUAGE } from "../../notifications/templates";
import { parseMetaWebhook } from "./mock";
import type { InboundWhatsAppEvent, SendResult, WhatsAppProvider } from "./types";

export class MetaWhatsAppProvider implements WhatsAppProvider {
  readonly name = "meta";
  private token = process.env.WHATSAPP_ACCESS_TOKEN ?? "";
  private appSecret = process.env.WHATSAPP_APP_SECRET ?? "";
  private defaultPhoneId = process.env.WHATSAPP_PHONE_NUMBER_ID ?? "";
  private version = process.env.WHATSAPP_GRAPH_VERSION ?? "v24.0";

  private base() {
    return `https://graph.facebook.com/${this.version}`;
  }

  private async post(phoneNumberId: string | null | undefined, body: Record<string, unknown>): Promise<SendResult> {
    const id = phoneNumberId || this.defaultPhoneId;
    if (!id || !this.token) throw new Error("WhatsApp not configured (WHATSAPP_ACCESS_TOKEN / phone_number_id)");
    const res = await fetch(`${this.base()}/${id}/messages`, {
      method: "POST",
      headers: { Authorization: `Bearer ${this.token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ messaging_product: "whatsapp", ...body }),
    });
    const data = (await res.json().catch(() => ({}))) as { messages?: { id: string }[]; error?: { message?: string; code?: number } };
    if (!res.ok || !data.messages?.[0]?.id) {
      throw new Error(`WhatsApp API ${res.status}: ${data.error?.message ?? "unknown error"} (code ${data.error?.code ?? "?"})`);
    }
    return { providerMessageId: data.messages[0].id };
  }

  async sendText(input: { phoneNumberId?: string | null; to: string; body: string }): Promise<SendResult> {
    return this.post(input.phoneNumberId, {
      recipient_type: "individual",
      to: input.to.replace(/^\+/, ""),
      type: "text",
      text: { body: input.body.slice(0, 4096), preview_url: true },
    });
  }

  async sendTemplate(input: { phoneNumberId?: string | null; to: string; template: string; locale: "ar" | "en" | "fr"; variables: string[] }): Promise<SendResult> {
    return this.post(input.phoneNumberId, {
      to: input.to.replace(/^\+/, ""),
      type: "template",
      template: {
        name: input.template,
        language: { code: META_LANGUAGE[input.locale] },
        components: input.variables.length ? [{ type: "body", parameters: input.variables.map((text) => ({ type: "text", text: text || "-" })) }] : [],
      },
    });
  }

  async markRead(phoneNumberId: string | null | undefined, messageId: string): Promise<void> {
    await this.post(phoneNumberId, { status: "read", message_id: messageId }).catch((e) => logger.warn("whatsapp mark read failed", { err: String(e) }));
  }

  verifySignature(rawBody: string, signatureHeader: string | null): boolean {
    if (!this.appSecret) {
      logger.error("WHATSAPP_APP_SECRET missing — rejecting webhook");
      return false;
    }
    if (!signatureHeader?.startsWith("sha256=")) return false;
    const expected = createHmac("sha256", this.appSecret).update(rawBody, "utf8").digest("hex");
    const a = Buffer.from(signatureHeader.slice(7), "hex");
    const b = Buffer.from(expected, "hex");
    return a.length === b.length && timingSafeEqual(a, b);
  }

  parseWebhook(body: unknown): InboundWhatsAppEvent[] {
    return parseMetaWebhook(body);
  }

  async downloadMedia(mediaId: string): Promise<{ data: Buffer; mimeType: string }> {
    const meta = await fetch(`${this.base()}/${mediaId}`, { headers: { Authorization: `Bearer ${this.token}` } });
    if (!meta.ok) throw new Error(`media lookup ${meta.status}`);
    const info = (await meta.json()) as { url: string; mime_type: string };
    const file = await fetch(info.url, { headers: { Authorization: `Bearer ${this.token}` } });
    if (!file.ok) throw new Error(`media download ${file.status}`);
    return { data: Buffer.from(await file.arrayBuffer()), mimeType: info.mime_type };
  }
}

/** Verify the GET handshake Meta sends when subscribing the webhook. */
export function verifyWebhookChallenge(params: URLSearchParams): string | null {
  const mode = params.get("hub.mode");
  const token = params.get("hub.verify_token");
  const challenge = params.get("hub.challenge");
  const expected = process.env.WHATSAPP_VERIFY_TOKEN;
  if (mode === "subscribe" && expected && token === expected && challenge) return challenge;
  return null;
}
