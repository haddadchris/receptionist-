import { afterAll, beforeAll, describe, expect, it } from "vitest";
import WebSocket from "ws";
import { and, eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { withSystem, withTenant } from "@fekerte/core/db/tenant";
import { appointments, businesses, calls } from "@fekerte/core/db/schema";
import { createUser } from "@fekerte/core/auth/users";
import { completeOnboarding, createBusiness } from "@fekerte/core/business/setup";
import { seedPlans, setupDentalCatalog } from "@fekerte/core/db/seed";
import { signVoiceToken } from "@fekerte/core/voice/tokens";
import { closeDb } from "@fekerte/core/db/client";
import { buildApp } from "../src/app";

const VOICE_NUMBER = "+12025550199";
let app: FastifyInstance;
let businessId: string;
let userId: string;
let port: number;

beforeAll(async () => {
  await seedPlans();
  const owner = await withSystem((tx) => createUser(tx, { email: `voice-${Date.now()}@t.test`, password: "password123", name: "Owner" }));
  userId = owner.id;
  const biz = await withSystem((tx) => createBusiness(tx, { ownerUserId: owner.id, name: "Voice Test Clinic", vertical: "dental", planTier: "premium", withDefaultHours: false }));
  businessId = biz.id;
  await withTenant(biz.id, async (tx) => {
    await setupDentalCatalog(tx, biz.id);
    await completeOnboarding(tx, biz.id);
  });
  await withSystem((tx) => tx.update(businesses).set({ voiceNumber: VOICE_NUMBER, status: "active" }).where(eq(businesses.id, biz.id)));
  app = await buildApp();
  await app.listen({ port: 0, host: "127.0.0.1" });
  port = (app.server.address() as { port: number }).port;
});

afterAll(async () => {
  await app?.close();
  await closeDb();
});

const form = (o: Record<string, string>) => new URLSearchParams(o).toString();

describe("Twilio webhooks (no Twilio credentials → <Gather> fallback pipeline)", () => {
  it("answers with a Lebanese greeting and books across gather turns", async () => {
    const first = await app.inject({ method: "POST", url: "/twilio/voice", headers: { "content-type": "application/x-www-form-urlencoded" }, payload: form({ CallSid: "CA-T1", From: "+96171333444", To: VOICE_NUMBER }) });
    expect(first.statusCode).toBe(200);
    expect(first.body).toContain("<Gather");
    expect(first.body).toContain("أهلا وسهلا");
    let action = first.body.match(/action="([^"]+)"/)![1]!.replace(/&amp;/g, "&");
    const say = async (speech: string) => {
      const url = new URL(action);
      const r = await app.inject({ method: "POST", url: url.pathname + url.search, headers: { "content-type": "application/x-www-form-urlencoded" }, payload: form({ CallSid: "CA-T1", SpeechResult: speech }) });
      const next = r.body.match(/action="([^"]+)"/);
      if (next) action = next[1]!.replace(/&amp;/g, "&");
      return r.body;
    };
    expect(await say("بدي موعد تنظيف أسنان بكرا الصبح")).toMatch(/أيّا بيناسبك/);
    await say("الأول");
    expect(await say("اسمي طوني حداد")).toMatch(/بأكّدلك/);
    expect(await say("إيه")).toMatch(/حجزتلك/);
    await app.inject({ method: "POST", url: "/twilio/status", headers: { "content-type": "application/x-www-form-urlencoded" }, payload: form({ CallSid: "CA-T1", CallStatus: "completed" }) });
    const [call] = await withTenant(businessId, (tx) => tx.select().from(calls).where(and(eq(calls.businessId, businessId), eq(calls.providerCallId, "CA-T1"))));
    expect(call!.outcome).toBe("booked");
    expect(call!.appointmentId).toBeTruthy();
    expect(call!.transcript.length).toBeGreaterThanOrEqual(8);
  });

  it("rejects unknown numbers politely", async () => {
    const r = await app.inject({ method: "POST", url: "/twilio/voice", headers: { "content-type": "application/x-www-form-urlencoded" }, payload: form({ CallSid: "CA-T2", From: "+9613", To: "+19999999999" }) });
    expect(r.body).toContain("<Hangup/>");
  });

  it("health reports provider status", async () => {
    const r = await app.inject({ method: "GET", url: "/health" });
    expect(r.json()).toMatchObject({ status: "ok", db: "ok", llm: "mock" });
  });
});

describe("browser call simulator WebSocket (text mode)", () => {
  function connect(token: string) {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/browser/session?token=${encodeURIComponent(token)}&mode=text`);
    const inbox: Record<string, unknown>[] = [];
    const waiters: ((m: Record<string, unknown>) => void)[] = [];
    ws.on("message", (raw) => {
      const m = JSON.parse(raw.toString());
      inbox.push(m);
      waiters.splice(0).forEach((w) => w(m));
    });
    const next = (type: string) =>
      new Promise<Record<string, unknown>>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`timeout waiting for ${type}`)), 10000);
        const check = () => {
          const i = inbox.findIndex((m) => m.type === type);
          if (i >= 0) {
            clearTimeout(timer);
            resolve(inbox.splice(i, 1)[0]!);
          } else waiters.push(check);
        };
        check();
      });
    return { ws, next, send: (m: object) => ws.send(JSON.stringify(m)) };
  }

  it("rejects bad tokens", async () => {
    const c = connect("nope");
    expect((await c.next("error")).message).toMatch(/token/);
  });

  it("books by voice turns and logs the call", async () => {
    const c = connect(signVoiceToken({ businessId, userId, callerPhone: "+96171555666" }));
    const ready = await c.next("ready");
    expect(ready.mode).toBe("text");
    expect(String(ready.greeting)).toContain("Voice Test Clinic");
    for (const [say, expectText] of [
      ["I'd like a teeth cleaning tomorrow morning", /Which works for you/],
      ["the first one", /full name/i],
      ["My name is Joe Caller", /Shall I book it/],
      ["yes", /booked/i],
    ] as const) {
      c.send({ type: "caller_text", text: say });
      const done = await c.next("agent_done");
      expect(String(done.text)).toMatch(expectText);
    }
    c.send({ type: "hangup" });
    const ended = await c.next("ended");
    const [call] = await withTenant(businessId, (tx) => tx.select().from(calls).where(eq(calls.id, String(ended.callId))));
    expect(call!.provider).toBe("browser");
    expect(call!.outcome).toBe("booked");
    const [appt] = await withTenant(businessId, (tx) => tx.select().from(appointments).where(eq(appointments.id, call!.appointmentId!)));
    expect(appt!.source).toBe("voice");
    c.ws.close();
  });
});
