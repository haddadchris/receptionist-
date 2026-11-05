/**
 * Daily billing sweep (system job, runs as the owner connection):
 *  1. Trials that ended without a paid invoice → business paused (AI off; the
 *     booking page keeps working) and a first invoice (setup + first month) is issued.
 *  2. Issued invoices overdue by BILLING_GRACE_DAYS → business paused.
 *  3. On the 1st of the month, issue monthly invoices for active businesses
 *     (BILLING_AUTO_INVOICE=false turns this off; admins can always generate manually).
 */
import { and, eq, inArray, lt } from "drizzle-orm";
import { DateTime } from "luxon";
import { withSystem } from "../db/tenant";
import { businesses, invoices, subscriptions } from "../db/schema";
import { audit } from "../lib/audit";
import { logger } from "../lib/logger";
import { createInvoice, generateMonthlyInvoices, pauseOverdueBusinesses } from "./invoices";

const SYSTEM = { type: "system", label: "billing" } as const;

export async function expireTrials(now: Date = new Date()) {
  return withSystem(async (tx) => {
    const expired = await tx
      .select()
      .from(businesses)
      .where(and(eq(businesses.status, "trial"), lt(businesses.trialEndsAt, now)));
    for (const b of expired) {
      await tx.update(businesses).set({ status: "paused" }).where(eq(businesses.id, b.id));
      await tx.update(subscriptions).set({ status: "past_due" }).where(eq(subscriptions.businessId, b.id));
      const [open] = await tx
        .select({ id: invoices.id })
        .from(invoices)
        .where(and(eq(invoices.businessId, b.id), inArray(invoices.status, ["issued", "draft"])));
      if (!open) {
        await createInvoice(tx, { businessId: b.id, period: DateTime.fromJSDate(now, { zone: b.timezone }).toFormat("yyyy-MM"), actor: SYSTEM });
      }
      await audit(tx, { businessId: b.id, actor: SYSTEM, action: "business.trial_expired", entityType: "business", entityId: b.id });
    }
    return expired.length;
  });
}

export async function runBillingSweep(now: Date = new Date()) {
  const trialsExpired = await expireTrials(now);
  const overduePaused = await withSystem((tx) => pauseOverdueBusinesses(tx));
  let invoiced = 0;
  const local = DateTime.fromJSDate(now, { zone: "Asia/Beirut" });
  if (local.day === 1 && process.env.BILLING_AUTO_INVOICE !== "false") {
    const created = await withSystem(async (tx) => {
      // Only active businesses get recurring invoices (trials are invoiced when they end).
      const rows = await generateMonthlyInvoices(tx, local.toFormat("yyyy-MM"), SYSTEM, { statuses: ["active"] });
      return rows.length;
    });
    invoiced = created;
  }
  logger.info("billing sweep", { trialsExpired, overduePaused, invoiced });
  return { trialsExpired, overduePaused, invoiced };
}
