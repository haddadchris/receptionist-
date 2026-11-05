import { afterEach, describe, expect, it } from "vitest";
import { buildEnvelope, parseDsn } from "../../src/lib/error-reporting";
import { rateLimit, rateLimitStore } from "../../src/lib/rate-limit";

describe("error reporting (Sentry envelope)", () => {
  it("parses a DSN into the envelope endpoint and public key", () => {
    expect(parseDsn("https://abc123@o42.ingest.sentry.io/4501234")).toEqual({ endpoint: "https://o42.ingest.sentry.io/api/4501234/envelope/", publicKey: "abc123" });
    expect(parseDsn("not a dsn")).toBeNull();
    expect(parseDsn(undefined)).toBeNull();
  });

  it("builds an envelope with the exception and strips customer content from context", () => {
    const { body, eventId } = buildEnvelope(new TypeError("boom"), { businessId: "b1", phone: "+96170111222", text: "hello" }, { service: "web", environment: "test" });
    const [header, itemHeader, item] = body.trim().split("\n");
    expect(JSON.parse(header!).event_id).toBe(eventId);
    expect(JSON.parse(itemHeader!).type).toBe("event");
    const event = JSON.parse(item!);
    expect(event.exception.values[0]).toMatchObject({ type: "TypeError", value: "boom" });
    expect(event.extra).toEqual({ businessId: "b1" });
    expect(body).not.toContain("+96170111222");
  });
});

describe("rate limiter (memory store)", () => {
  afterEach(() => {
    delete process.env.RATE_LIMIT_STORE;
  });
  it("defaults to memory outside production", () => {
    expect(rateLimitStore()).toBe("memory");
    process.env.RATE_LIMIT_STORE = "postgres";
    expect(rateLimitStore()).toBe("postgres");
  });
  it("allows `limit` hits per window", async () => {
    const key = `t:${Math.random()}`;
    const results = [];
    for (let i = 0; i < 4; i++) results.push(await rateLimit(key, 3, 60_000));
    expect(results.map((r) => r.ok)).toEqual([true, true, true, false]);
    expect(results[3]!.retryAfterMs).toBeGreaterThan(0);
  });
});
