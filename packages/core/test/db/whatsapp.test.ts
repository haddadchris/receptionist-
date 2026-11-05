import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createHmac } from "node:crypto";
import { and, asc, eq } from "drizzle-orm";
import { closeDb } from "../../src/db/client";
import { withSystem, withTenant } from "../../src/db/tenant";
import { appointments, businesses, conversations, messages, usageEvents } from "../../src/db/schema";
import { setProviders } from "../../src/providers";
import { MockWhatsAppProvider } from "../../src/providers/whatsapp/mock";
import { MetaWhatsAppProvider, verifyWebhookChallenge } from "../../src/providers/whatsapp/meta";
import { ingestWhatsAppWebhook, processWhatsAppConversation, simulatedInbound } from "../../src/channels/whatsapp";
import { setConversationStatus } from "../../src/agent/conversations";
import { setLLMProvider, MockLLMProvider } from "../../src/agent/llm";
import { createBooking } from "../../src/booking/service";
import { createTestBusiness, dbAvailable, futureDate, localIso, type TestBusiness } from "../fixtures";

describe.skipIf(!dbAvailable())("WhatsApp channel", () => {
  let b: TestBusiness;
  let wa: MockWhatsAppProvider;
  const PHONE_ID = `test-wa-${Date.now()}`;

  beforeAll(async () => {
    b = await createTestBusiness();
    await withSystem((tx) => tx.update(businesses).set({ whatsappPhoneNumberId: PHONE_ID, planTier: "standard", status: "active" }).where(eq(businesses.id, b.businessId)));
    setLLMProvider(new MockLLMProvider());
  });
  beforeEach(() => {
    wa = new MockWhatsAppProvider();
    setProviders({ whatsapp: wa });
  });
  afterAll(async () => {
    setLLMProvider(null);
    await closeDb();
  });

  async function send(from: string, text: string) {
    const payload = simulatedInbound({ phoneNumberId: PHONE_ID, from, text, name: "Test Person" });
    const res = await ingestWhatsAppWebhook(payload);
    for (const c of res.conversations) await processWhatsAppConversation(c.businessId, c.conversationId);
    return { payload, res };
  }

  async function thread(conversationId: string) {
    return withTenant(b.businessId, (tx) => tx.select().from(messages).where(eq(messages.conversationId, conversationId)).orderBy(asc(messages.createdAt)));
  }

  it("answers an inbound message with the AI and records usage", async () => {
    const { res } = await send("+96170900001", "adesh el tanzif?");
    expect(res.conversations).toHaveLength(1);
    expect(wa.outbox).toHaveLength(1);
    expect(wa.outbox[0]!.body).toContain("$60");
    const msgs = await thread(res.conversations[0]!.conversationId);
    expect(msgs.map((m) => `${m.direction}:${m.sender}`)).toEqual(["inbound:customer", "outbound:ai"]);
    expect(msgs[1]!.toolCalls?.map((t) => t.name)).toEqual(["list_services"]);
    const usage = await withTenant(b.businessId, (tx) => tx.select().from(usageEvents).where(eq(usageEvents.businessId, b.businessId)));
    expect(usage.some((u) => u.type === "ai_message")).toBe(true);
  });

  it("ignores duplicate webhook deliveries", async () => {
    const payload = simulatedInbound({ phoneNumberId: PHONE_ID, from: "+96170900002", text: "marhaba" });
    const first = await ingestWhatsAppWebhook(payload);
    const second = await ingestWhatsAppWebhook(payload);
    expect(first.conversations).toHaveLength(1);
    expect(second.conversations).toHaveLength(0);
  });

  it("books end-to-end over WhatsApp", async () => {
    const from = "+96170900003";
    await send(from, "badde 7jez tanzif bukra");
    expect(wa.outbox.at(-1)!.body).toMatch(/1\./);
    // The WhatsApp profile name ("Test Person") is used as the customer's name, so picking a slot books it.
    await send(from, "1");
    expect(wa.outbox.at(-1)!.body).toContain("7ajaztellak");
    const [convo] = await withTenant(b.businessId, (tx) => tx.select().from(conversations).where(eq(conversations.externalId, from)));
    const booked = await withTenant(b.businessId, (tx) => tx.select().from(appointments).where(eq(appointments.conversationId, convo!.id)));
    expect(booked).toHaveLength(1);
    expect(booked[0]!.source).toBe("whatsapp");
  });

  it("does not reply while a human has taken over", async () => {
    const from = "+96170900004";
    const { res } = await send(from, "marhaba");
    const conversationId = res.conversations[0]!.conversationId;
    await withTenant(b.businessId, (tx) => setConversationStatus(tx, b.businessId, conversationId, "human_takeover", { type: "user", userId: b.owner.id }));
    const before = wa.outbox.length;
    await send(from, "adesh el checkup?");
    expect(wa.outbox.length).toBe(before);
    const msgs = await thread(conversationId);
    expect(msgs.at(-1)!.direction).toBe("inbound");
  });

  it("hands off emergencies and stops the AI", async () => {
    const { res } = await send("+96170900005", "my gum is bleeding a lot");
    const [convo] = await withTenant(b.businessId, (tx) => tx.select().from(conversations).where(eq(conversations.id, res.conversations[0]!.conversationId)));
    expect(convo!.status).toBe("human_takeover");
    expect(wa.outbox.at(-1)!.body).toContain("140");
  });

  it("confirms the appointment when the customer replies 1 to a reminder", async () => {
    const from = "+96170900006";
    const appt = await withTenant(b.businessId, (tx) =>
      createBooking(tx, b.businessId, {
        serviceId: b.checkup.id,
        startsAt: localIso(futureDate(3), "10:00"),
        customer: { phone: from, name: "Reminder Person", language: "en" },
        source: "booking_page",
        actor: { type: "customer" },
        notifyCustomer: false,
      }),
    );
    // Simulate the reminder template landing in the conversation.
    const { getOrCreateConversation, appendMessage } = await import("../../src/agent/conversations");
    await withTenant(b.businessId, async (tx) => {
      const c = await getOrCreateConversation(tx, b.businessId, { channel: "whatsapp", externalId: from, customerId: appt.customerId });
      await appendMessage(tx, { businessId: b.businessId, conversationId: c.id, direction: "outbound", sender: "system", contentType: "template", body: "Reminder 🗓️ … Reply 1 to confirm or 2 to reschedule." });
    });
    await send(from, "1");
    const [after] = await withTenant(b.businessId, (tx) => tx.select().from(appointments).where(and(eq(appointments.id, appt.id))));
    expect(after!.customerConfirmedAt).not.toBeNull();
    expect(wa.outbox.at(-1)!.body).toMatch(/confirmed/i);
  });
});

describe("Meta webhook security", () => {
  it("verifies X-Hub-Signature-256 with the app secret", () => {
    process.env.WHATSAPP_APP_SECRET = "test-secret";
    const p = new MetaWhatsAppProvider();
    const body = JSON.stringify({ hello: "world" });
    const sig = "sha256=" + createHmac("sha256", "test-secret").update(body).digest("hex");
    expect(p.verifySignature(body, sig)).toBe(true);
    expect(p.verifySignature(body + " ", sig)).toBe(false);
    expect(p.verifySignature(body, "sha256=" + "0".repeat(64))).toBe(false);
    expect(p.verifySignature(body, null)).toBe(false);
  });
  it("answers the subscription challenge only with the right verify token", () => {
    process.env.WHATSAPP_VERIFY_TOKEN = "verify-me";
    expect(verifyWebhookChallenge(new URLSearchParams({ "hub.mode": "subscribe", "hub.verify_token": "verify-me", "hub.challenge": "42" }))).toBe("42");
    expect(verifyWebhookChallenge(new URLSearchParams({ "hub.mode": "subscribe", "hub.verify_token": "nope", "hub.challenge": "42" }))).toBeNull();
  });
});
