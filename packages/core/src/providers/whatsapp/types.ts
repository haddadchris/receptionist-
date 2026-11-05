import type { Locale } from "../../db/schema";
import type { TemplateName } from "../../notifications/templates";

export type SendResult = { providerMessageId: string };

export type InboundWhatsAppEvent =
  | {
      kind: "message";
      phoneNumberId: string;
      from: string;
      profileName?: string;
      providerMessageId: string;
      timestamp: Date;
      type: "text" | "audio" | "image" | "location" | "interactive" | "button" | "other";
      text?: string;
      mediaId?: string;
      mimeType?: string;
    }
  | {
      kind: "status";
      phoneNumberId: string;
      providerMessageId: string;
      status: "sent" | "delivered" | "read" | "failed";
      error?: string;
    };

export interface WhatsAppProvider {
  readonly name: string;
  sendText(input: { phoneNumberId?: string | null; to: string; body: string }): Promise<SendResult>;
  sendTemplate(input: {
    phoneNumberId?: string | null;
    to: string;
    template: TemplateName;
    locale: Locale;
    variables: string[];
    /** Rendered text, for logging / mock display. */
    renderedBody: string;
  }): Promise<SendResult>;
  /** Verify the X-Hub-Signature-256 header against the raw request body. */
  verifySignature(rawBody: string, signatureHeader: string | null): boolean;
  parseWebhook(body: unknown): InboundWhatsAppEvent[];
  downloadMedia(mediaId: string): Promise<{ data: Buffer; mimeType: string }>;
}
