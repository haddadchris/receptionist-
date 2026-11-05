import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { DateTime } from "luxon";
import { withSuperAdmin, withSystem, withTenant } from "../../src/db/tenant";
import { closeDb } from "../../src/db/client";
import { businesses, invoices, payments, plans, subscriptions, usageEvents } from "../../src/db/schema";
import { recordUsage } from "../../src/lib/usage";
import { periodKey } from "../../src/lib/time";
import { checkAiAllowed, usageSummary } from "../../src/billing/limits";
import { buildInvoiceLines, createInvoice, generateMonthlyInvoices, markInvoicePaid, pauseOverdueBusinesses, voidInvoice } from "../../src/billing/invoices";
import { applyPlanChange, requestPlanChange, updatePlan } from "../../src/billing/plans";
import { expireTrials } from "../../src/billing/sweep";
import { getBillingOverview } from "../../src/billing/account";
import { getAvailableSlots, createBooking } from "../../src/booking/service";
import { hasFeature } from "../../src/billing/features";
import { createTestBusiness, dbAvailable, futureDate, localIso, type TestBusiness } from "../fixtures";

const ADMIN = { type: "system", label: "test" } as const;
const getBiz = (id: string) => withSystem(async (tx) => (await tx.select().from(businesses).where(eq(businesses.id, id)))[0]!);

describe.skipIf(!dbAvailable())("billing: plans, limits, invoices, trial", () => {
  let t: TestBusiness;
  beforeAll(async () => {
    t = await createTestBusiness({ name: "Billing Clinic" });
  });
  afterAll(() => closeDb());

  it("gates features by tier and per-business overrides", async () => {
    expect(hasFeature({ planTier: "basic", featureFlags: {} }, "whatsappAi")).toBe(false);
    expect(hasFeature({ planTier: "standard", featureFlags: {} }, "whatsappAi")).toBe(true);
    expect(hasFeature({ planTier: "standard", featureFlags: {} }, "voiceAi")).toBe(false);
    expect(hasFeature({ planTier: "premium", featureFlags: {} }, "voiceAi")).toBe(true);
    expect(hasFeature({ planTier: "basic", featureFlags: { whatsappAi: true } }, "whatsappAi")).toBe(true);
    const b = await getBiz(t.businessId);
    expect(b.status).toBe("trial");
    expect(await checkAiAllowed(b, "voiceAi")).toEqual({ ok: true });
    await withSystem((tx) => applyPlanChange(tx, t.businessId, "standard", ADMIN));
    const std = await getBiz(t.businessId);
    expect(await checkAiAllowed(std, "voiceAi")).toEqual({ ok: false, reason: "plan" });
    expect(await checkAiAllowed(std, "whatsappAi")).toEqual({ ok: true });
  });

  it("tracks included usage, overage and the safety hard cap", async () => {
    const other = await createTestBusiness({ name: "Usage Clinic" });
    await withSystem((tx) => applyPlanChange(tx, other.businessId, "standard", ADMIN));
    const plan = (await withSystem((tx) => tx.select().from(plans).where(eq(plans.tier, "standard"))))[0]!;
    await withTenant(other.businessId, (tx) => recordUsage(tx, other.businessId, "ai_message", plan.includedAiMessages + 10));
    const b = await getBiz(other.businessId);
    const u = await usageSummary(b);
    expect(u.overageAiMessages).toBe(10);
    expect(u.overageCents).toBe(10 * plan.overageAiMessageCents);
    expect(u.hardCapReached.ai).toBe(false);
    expect(await checkAiAllowed(b, "whatsappAi")).toEqual({ ok: true }); // overage is allowed and billed
    await withTenant(other.businessId, (tx) => recordUsage(tx, other.businessId, "ai_message", plan.includedAiMessages * 2));
    expect((await usageSummary(b)).hardCapReached.ai).toBe(true);
    expect(await checkAiAllowed(b, "whatsappAi")).toEqual({ ok: false, reason: "usage_cap" });
    // Booking page is unaffected by AI limits.
    const slots = await withTenant(other.businessId, (tx) =>
      getAvailableSlots(tx, other.businessId, { serviceId: other.checkup.id, fromDate: futureDate(3), toDate: futureDate(3) }),
    );
    expect(slots.length).toBeGreaterThan(0);
  });

  it("builds invoice lines: monthly fee, unpaid setup fee, previous month's overage", async () => {
    const b = await getBiz(t.businessId);
    const prev = DateTime.now().setZone(b.timezone).minus({ months: 1 }).toFormat("yyyy-MM");
    const thisPeriod = periodKey(b.timezone);
    const plan = (await withSystem((tx) => tx.select().from(plans).where(eq(plans.tier, "standard"))))[0]!;
    await withSystem((tx) =>
      tx.insert(usageEvents).values({ businessId: t.businessId, type: "ai_message", quantity: plan.includedAiMessages + 4, period: prev }),
    );
    const lines = await withSystem((tx) => buildInvoiceLines(tx, b, thisPeriod));
    expect(lines[0]!.totalCents).toBe(plan.monthlyFeeCents);
    expect(lines.find((l) => /setup/i.test(l.description))?.totalCents).toBe(plan.setupFeeCents);
    expect(lines.find((l) => /AI messages over plan/.test(l.description))?.totalCents).toBe(4 * plan.overageAiMessageCents);
  });

  it("trial expiry pauses AI, issues a first invoice, keeps booking working; paying reactivates", async () => {
    await withSystem((tx) => tx.update(businesses).set({ trialEndsAt: DateTime.now().minus({ hours: 1 }).toJSDate() }).where(eq(businesses.id, t.businessId)));
    const expiredBefore = await getBiz(t.businessId);
    expect(await checkAiAllowed(expiredBefore, "whatsappAi")).toEqual({ ok: false, reason: "trial_expired" });
    expect(await expireTrials()).toBeGreaterThanOrEqual(1);
    const paused = await getBiz(t.businessId);
    expect(paused.status).toBe("paused");
    expect(await checkAiAllowed(paused, "whatsappAi")).toEqual({ ok: false, reason: "paused" });
    const open = await withSystem((tx) => tx.select().from(invoices).where(and(eq(invoices.businessId, t.businessId), eq(invoices.status, "issued"))));
    expect(open).toHaveLength(1);
    expect(open[0]!.number).toMatch(/^FK-\d{4}-\d{4}$/);

    // Public booking still works while paused.
    const appt = await withTenant(t.businessId, (tx) =>
      createBooking(tx, t.businessId, {
        serviceId: t.checkup.id,
        startsAt: localIso(futureDate(6), "11:00"),
        customer: { phone: "+96170111222", name: "Paused Booker" },
        source: "booking_page",
        actor: { type: "customer" },
      }),
    );
    expect(appt.id).toBeTruthy();

    // Owner overview shows the open invoice and paused AI.
    const overview = await getBillingOverview(paused);
    expect(overview.openInvoice?.id).toBe(open[0]!.id);
    expect(overview.aiStatus.whatsapp).toBe("paused");

    const paid = await withSuperAdmin((tx) => markInvoicePaid(tx, { invoiceId: open[0]!.id, method: "wallet", reference: "WHISH-123", actor: ADMIN }));
    expect(paid.status).toBe("paid");
    const active = await getBiz(t.businessId);
    expect(active.status).toBe("active");
    expect(await checkAiAllowed(active, "whatsappAi")).toEqual({ ok: true });
    const [sub] = await withSystem((tx) => tx.select().from(subscriptions).where(eq(subscriptions.businessId, t.businessId)));
    expect(sub!.status).toBe("active");
    expect(sub!.setupFeePaid).toBe(true);
    const pays = await withSystem((tx) => tx.select().from(payments).where(eq(payments.invoiceId, open[0]!.id)));
    expect(pays).toHaveLength(1);
    expect(pays[0]!.providerRef).toBe("WHISH-123");
    // Marking paid twice is a no-op.
    await withSuperAdmin((tx) => markInvoicePaid(tx, { invoiceId: open[0]!.id, method: "cash", actor: ADMIN }));
    expect(await withSystem((tx) => tx.select().from(payments).where(eq(payments.invoiceId, open[0]!.id)))).toHaveLength(1);
  });

  it("pauses businesses with overdue invoices and lets admins void invoices", async () => {
    const inv = await withSuperAdmin((tx) => createInvoice(tx, { businessId: t.businessId, period: "2020-01", actor: ADMIN }));
    await withSystem((tx) => tx.update(invoices).set({ dueAt: DateTime.now().minus({ days: 30 }).toJSDate() }).where(eq(invoices.id, inv.id)));
    expect(await withSystem((tx) => pauseOverdueBusinesses(tx))).toBeGreaterThanOrEqual(1);
    expect((await getBiz(t.businessId)).status).toBe("paused");
    await withSuperAdmin((tx) => voidInvoice(tx, inv.id, ADMIN));
    await expect(withSuperAdmin((tx) => markInvoicePaid(tx, { invoiceId: inv.id, method: "cash", actor: ADMIN }))).rejects.toThrow(/void/);
    await withSystem((tx) => tx.update(businesses).set({ status: "active" }).where(eq(businesses.id, t.businessId)));
  });

  it("generates monthly invoices once per business per period", async () => {
    const first = await withSuperAdmin((tx) => generateMonthlyInvoices(tx, "2031-03", ADMIN, { businessIds: [t.businessId] }));
    const again = await withSuperAdmin((tx) => generateMonthlyInvoices(tx, "2031-03", ADMIN, { businessIds: [t.businessId] }));
    expect(first).toHaveLength(1);
    expect(again).toHaveLength(0);
    // Setup fee was paid → not billed again.
    expect(first[0]!.lines.some((l) => /setup/i.test(l.description))).toBe(false);
  });

  it("plan changes: trials switch instantly, active subscriptions need approval", async () => {
    const trial = await createTestBusiness({ name: "Trial Switch" });
    expect(await withSystem((tx) => requestPlanChange(tx, trial.businessId, "basic", { type: "user", userId: trial.owner.id }))).toBe("applied");
    expect((await getBiz(trial.businessId)).planTier).toBe("basic");
    // t is active (standard)
    expect(await withSystem((tx) => requestPlanChange(tx, t.businessId, "premium", { type: "user", userId: t.owner.id }))).toBe("requested");
    expect((await getBiz(t.businessId)).planTier).toBe("standard");
    const [sub] = await withSystem((tx) => tx.select().from(subscriptions).where(eq(subscriptions.businessId, t.businessId)));
    expect(sub!.pendingPlanTier).toBe("premium");
    await withSuperAdmin((tx) => applyPlanChange(tx, t.businessId, "premium", ADMIN));
    expect((await getBiz(t.businessId)).planTier).toBe("premium");
  });

  it("admin can edit plan pricing", async () => {
    const [before] = await withSystem((tx) => tx.select().from(plans).where(eq(plans.tier, "basic")));
    await withSuperAdmin((tx) => updatePlan(tx, { ...before!, monthlyFeeCents: before!.monthlyFeeCents + 100 }, ADMIN));
    const [after] = await withSystem((tx) => tx.select().from(plans).where(eq(plans.tier, "basic")));
    expect(after!.monthlyFeeCents).toBe(before!.monthlyFeeCents + 100);
    await withSuperAdmin((tx) => updatePlan(tx, before!, ADMIN));
  });

  it("RLS: owners can read but not write billing state", async () => {
    const own = await withTenant(t.businessId, (tx) => tx.select().from(invoices).where(eq(invoices.businessId, t.businessId)));
    expect(own.length).toBeGreaterThan(0);
    // Cannot mark own invoice paid / change subscription / delete usage / change plan.
    const upd = await withTenant(t.businessId, (tx) => tx.update(invoices).set({ status: "paid" }).where(eq(invoices.businessId, t.businessId)).returning());
    expect(upd).toHaveLength(0);
    const subUpd = await withTenant(t.businessId, (tx) => tx.update(subscriptions).set({ monthlyFeeCents: 0 }).where(eq(subscriptions.businessId, t.businessId)).returning());
    expect(subUpd).toHaveLength(0);
    const del = await withTenant(t.businessId, (tx) => tx.delete(usageEvents).where(eq(usageEvents.businessId, t.businessId)).returning());
    expect(del).toHaveLength(0);
    const err = await withTenant(t.businessId, (tx) => tx.update(businesses).set({ planTier: "basic" }).where(eq(businesses.id, t.businessId))).catch((e: Error) => e);
    expect(err).toBeInstanceOf(Error);
    expect(String((err as Error & { cause?: Error }).cause?.message ?? (err as Error).message)).toMatch(/administrator/);
    await expect(
      withTenant(t.businessId, (tx) => tx.insert(payments).values({ businessId: t.businessId, kind: "subscription", amountCents: 1, method: "cash", status: "succeeded" })),
    ).rejects.toThrow();
    // Usage can still be appended, and normal settings updates still work.
    await withTenant(t.businessId, (tx) => recordUsage(tx, t.businessId, "ai_message", 1));
    await withTenant(t.businessId, (tx) => tx.update(businesses).set({ phone: "+9611234567" }).where(eq(businesses.id, t.businessId)));
    // Another tenant can't see these invoices.
    const other = await createTestBusiness({ name: "Nosy Clinic" });
    const peek = await withTenant(other.businessId, (tx) => tx.select().from(invoices).where(eq(invoices.businessId, t.businessId)));
    expect(peek).toHaveLength(0);
  });
});
