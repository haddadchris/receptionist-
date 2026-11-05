import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { asc, eq } from "drizzle-orm";
import { closeDb } from "../../src/db/client";
import { withSystem, withTenant } from "../../src/db/tenant";
import { businesses, conversations, messages } from "../../src/db/schema";
import { rateLimit } from "../../src/lib/rate-limit";
import { setProviders } from "../../src/providers";
import { MockWhatsAppProvider } from "../../src/providers/whatsapp/mock";
import { ingestWhatsAppWebhook, processWhatsAppConversation, simulatedInbound } from "../../src/channels/whatsapp";
import { MockLLMProvider, setLLMProvider } from "../../src/agent/llm";
import { routeIncomingCall } from "../../src/voice/routing";
import { getBusiness } from "../../src/availability/loader";
import { createTestBusiness, dbAvailable } from "../fixtures";

describe.skipIf(!dbAvailable())("shared rate limits + AI caps", () => {
  beforeAll(() => setLLMProvider(new MockLLMProvider()));
  afterEach(() => {
    delete process.env.RATE_LIMIT_STORE;
    delete process.env.AI_MAX_REPLIES_PER_HOUR;
    delete process.env.AI_MAX_CALLS_PER_HOUR;
  });
  afterAll(async () => {
    setLLMProvider(null);
    await closeDb();
  });

  it("postgres store counts across callers (multi-instance safe)", async () => {
    process.env.RATE_LIMIT_STORE = "postgres";
    const key = `pg:${Math.random()}`;
    const r = await Promise.all([1, 2, 3, 4, 5].map(() => rateLimit(key, 3, 60_000)));
    expect(r.filter((x) => x.ok)).toHaveLength(3);
    expect(r.filter((x) => !x.ok)).toHaveLength(2);
  });

  it("WhatsApp: past the hourly AI cap the conversation goes to staff", async () => {
    process.env.AI_MAX_REPLIES_PER_HOUR = "2";
    const b = await createTestBusiness({ name: "Capped Clinic" });
    const phoneId = `cap-wa-${Date.now()}`;
    await withSystem((tx) => tx.update(businesses).set({ whatsappPhoneNumberId: phoneId, status: "active" }).where(eq(businesses.id, b.businessId)));
    const wa = new MockWhatsAppProvider();
    setProviders({ whatsapp: wa });
    const from = `+96170${String(Date.now()).slice(-6)}`;
    let convoId = "";
    for (const text of ["adesh el tanzif?", "w el fa7es?", "w el tabyid?"]) {
      const res = await ingestWhatsAppWebhook(simulatedInbound({ phoneNumberId: phoneId, from, text }));
      convoId = res.conversations[0]!.conversationId;
      await processWhatsAppConversation(b.businessId, convoId);
    }
    const [convo] = await withTenant(b.businessId, (tx) => tx.select().from(conversations).where(eq(conversations.id, convoId)));
    expect(convo!.status).toBe("human_takeover");
    const thread = await withTenant(b.businessId, (tx) => tx.select().from(messages).where(eq(messages.conversationId, convoId)).orderBy(asc(messages.createdAt)));
    expect(thread.filter((m) => m.sender === "ai")).toHaveLength(2);
    expect(wa.outbox.at(-1)!.body).toMatch(/passed this conversation to the team|7awwalt|حوّلت/);
  });

  it("phone: one caller hammering the AI line gets the business / voicemail instead", async () => {
    process.env.AI_MAX_CALLS_PER_HOUR = "1";
    const b = await createTestBusiness({ name: "Call Cap Clinic" });
    await withSystem((tx) => tx.update(businesses).set({ status: "active" }).where(eq(businesses.id, b.businessId)));
    const biz = await withTenant(b.businessId, (tx) => getBusiness(tx, b.businessId));
    const from = `+96171${String(Date.now()).slice(-6)}`;
    expect((await routeIncomingCall(biz, { from })).kind).toBe("ai");
    expect((await routeIncomingCall(biz, { from })).kind).not.toBe("ai");
    expect((await routeIncomingCall(biz, { from: "+96171000001" })).kind).toBe("ai");
  });
});
