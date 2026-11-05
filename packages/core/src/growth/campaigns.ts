/**
 * WhatsApp campaigns: broadcast an approved MARKETING template
 * (`campaign_generic`) to a customer segment. Only customers with marketing
 * consent who haven't opted out receive it; every message says "reply STOP".
 * Sending runs as a job in batches (one notification row per recipient, unique
 * per campaign, so retries never double-send).
 */
import { and, desc, eq, isNull, notExists, sql } from "drizzle-orm";
import { z } from "zod";
import { withTenant, type Tx } from "../db/tenant";
import { campaigns, customers, notifications, type Job, type SegmentDefinition } from "../db/schema";
import { segmentConditions } from "../crm/customers";
import { enqueueJob } from "../jobs/queue";
import { audit, type Actor } from "../lib/audit";
import { DomainError } from "../lib/errors";
import { sendCustomerTemplate } from "../notifications/customer";
import { logger } from "../lib/logger";

export const CAMPAIGN_JOB = "campaign.send";
const BATCH = 50;

export const segmentSchema = z.object({
  tags: z.array(z.string().trim().min(1).max(40)).max(10).optional(),
  noVisitDays: z.number().int().min(1).max(3650).optional(),
  minNoShows: z.number().int().min(1).max(50).optional(),
  hasUpcoming: z.boolean().optional(),
  serviceIds: z.array(z.string().uuid()).max(20).optional(),
  marketingOptIn: z.boolean().optional(),
});

export const campaignInputSchema = z.object({
  name: z.string().trim().min(2).max(80),
  segment: segmentSchema,
  // Meta template parameters can't contain newlines/tabs or 4+ consecutive spaces.
  message: z
    .string()
    .trim()
    .min(5)
    .max(600)
    .transform((m) => m.replace(/[\r\n\t]+/g, " ").replace(/ {4,}/g, "   ")),
});

/** Segment members who may receive marketing messages. */
function eligibleConditions(businessId: string, segment: SegmentDefinition) {
  return [
    ...segmentConditions(businessId, segment),
    eq(customers.consentWhatsapp, true),
    eq(customers.consentMarketing, true),
    isNull(customers.optedOutAt),
  ];
}

export async function previewAudience(tx: Tx, businessId: string, segment: SegmentDefinition) {
  const [m] = await tx.select({ n: sql<number>`count(*)::int` }).from(customers).where(and(...segmentConditions(businessId, segment)));
  const [e] = await tx.select({ n: sql<number>`count(*)::int` }).from(customers).where(and(...eligibleConditions(businessId, segment)));
  return { matched: m?.n ?? 0, eligible: e?.n ?? 0 };
}

export async function createCampaign(tx: Tx, businessId: string, input: z.input<typeof campaignInputSchema>, actor: Actor) {
  const p = campaignInputSchema.parse(input);
  const [row] = await tx
    .insert(campaigns)
    .values({ businessId, name: p.name, segment: p.segment, templateName: "campaign_generic", variables: { message: p.message }, status: "draft" })
    .returning();
  await audit(tx, { businessId, actor, action: "campaign.created", entityType: "campaign", entityId: row!.id, changes: { name: p.name, segment: p.segment } });
  return row!;
}

export async function scheduleCampaign(tx: Tx, businessId: string, campaignId: string, at: Date | null, actor: Actor) {
  const [c] = await tx.select().from(campaigns).where(and(eq(campaigns.id, campaignId), eq(campaigns.businessId, businessId)));
  if (!c) throw new DomainError("NOT_FOUND", "Campaign not found");
  if (c.status !== "draft" && c.status !== "scheduled") throw new DomainError("CONFLICT", "Campaign already sent");
  const { eligible } = await previewAudience(tx, businessId, c.segment);
  if (eligible === 0) throw new DomainError("VALIDATION", "No customers in this segment can receive marketing messages");
  const runAt = at && at > new Date() ? at : new Date();
  await tx.update(campaigns).set({ status: "scheduled", scheduledAt: runAt, recipientCount: eligible }).where(eq(campaigns.id, c.id));
  await enqueueJob(tx, { type: CAMPAIGN_JOB, businessId, runAt, payload: { campaignId: c.id }, dedupeKey: `campaign:${c.id}:${runAt.toISOString()}` });
  await audit(tx, { businessId, actor, action: "campaign.scheduled", entityType: "campaign", entityId: c.id, changes: { at: runAt, recipients: eligible } });
}

export async function cancelCampaign(tx: Tx, businessId: string, campaignId: string, actor: Actor) {
  const [c] = await tx
    .update(campaigns)
    .set({ status: "cancelled" })
    .where(and(eq(campaigns.id, campaignId), eq(campaigns.businessId, businessId), sql`${campaigns.status} in ('draft','scheduled','sending')`))
    .returning();
  if (!c) throw new DomainError("CONFLICT", "Campaign can't be cancelled");
  await audit(tx, { businessId, actor, action: "campaign.cancelled", entityType: "campaign", entityId: c.id });
}

export async function listCampaigns(tx: Tx, businessId: string) {
  return tx.select().from(campaigns).where(eq(campaigns.businessId, businessId)).orderBy(desc(campaigns.createdAt)).limit(100);
}

/** Job: send the next batch; re-enqueues itself until everyone eligible has a notification row. */
export async function handleCampaignJob(job: Job): Promise<void | { skipped: string }> {
  const businessId = job.businessId;
  const { campaignId } = job.payload as { campaignId: string };
  if (!businessId) return { skipped: "no business" };
  const batch = await withTenant(businessId, async (tx) => {
    const [c] = await tx.select().from(campaigns).where(and(eq(campaigns.id, campaignId), eq(campaigns.businessId, businessId)));
    if (!c || (c.status !== "scheduled" && c.status !== "sending")) return null;
    if (c.status === "scheduled") await tx.update(campaigns).set({ status: "sending" }).where(eq(campaigns.id, c.id));
    const recipients = await tx
      .select({ id: customers.id })
      .from(customers)
      .where(
        and(
          ...eligibleConditions(businessId, c.segment),
          notExists(tx.select({ one: sql`1` }).from(notifications).where(and(eq(notifications.campaignId, c.id), sql`${notifications.customerId} = "customers"."id"`))),
        ),
      )
      .limit(BATCH);
    return { c, recipients };
  });
  if (!batch) return { skipped: "campaign not active" };
  const message = String(batch.c.variables.message ?? "");
  let sent = 0;
  for (const r of batch.recipients) {
    try {
      const res = await sendCustomerTemplate({
        businessId,
        customerId: r.id,
        campaignId: campaignId,
        template: "campaign_generic",
        variables: ({ customer, business }) => [customer.name?.split(" ")[0] ?? "", business.name, message],
      });
      if (res.status === "sent") sent++;
    } catch (err) {
      logger.warn("campaign send failed", { campaignId, customerId: r.id, err: String(err) });
    }
  }
  await withTenant(businessId, async (tx) => {
    await tx.update(campaigns).set({ sentCount: sql`${campaigns.sentCount} + ${sent}` }).where(eq(campaigns.id, campaignId));
    if (batch.recipients.length === BATCH) {
      await enqueueJob(tx, { type: CAMPAIGN_JOB, businessId, runAt: new Date(Date.now() + 2000), payload: { campaignId }, dedupeKey: `campaign:${campaignId}:${Date.now()}` });
    } else {
      await tx.update(campaigns).set({ status: "sent", sentAt: new Date() }).where(and(eq(campaigns.id, campaignId), eq(campaigns.status, "sending")));
    }
  });
}
