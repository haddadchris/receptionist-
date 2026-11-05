/**
 * Recalls: per-service rule (`services.recall_interval_days`, e.g. cleaning →
 * 180 days). When a visit is completed, a recall is scheduled for that many
 * days later; at send time it is skipped if the customer already rebooked,
 * has a later visit for the same service, or opted out.
 */
import { and, eq, gt, inArray, sql } from "drizzle-orm";
import { DateTime } from "luxon";
import { withTenant, type Tx } from "../db/tenant";
import { appointments, services, type Appointment, type Business, type Job } from "../db/schema";
import { hasFeature } from "../billing/features";
import { enqueueJob } from "../jobs/queue";
import { bookingUrl } from "../booking/tokens";
import { pickLocalized } from "../lib/i18n";
import { sendCustomerTemplate } from "../notifications/customer";
import { intoSendingWindow } from "./schedule";

export const RECALL_JOB = "recall.send";

export async function scheduleRecall(tx: Tx, business: Business, appt: Pick<Appointment, "id" | "businessId" | "serviceId" | "startsAt">) {
  if (!hasFeature(business, "recalls")) return false;
  const [svc] = await tx.select({ days: services.recallIntervalDays }).from(services).where(eq(services.id, appt.serviceId));
  if (!svc?.days || svc.days <= 0) return false;
  const at = DateTime.fromJSDate(appt.startsAt).setZone(business.timezone).plus({ days: svc.days }).set({ hour: 11, minute: 0, second: 0, millisecond: 0 });
  await enqueueJob(tx, {
    type: RECALL_JOB,
    businessId: appt.businessId,
    runAt: intoSendingWindow(at.toJSDate(), business.timezone),
    payload: { appointmentId: appt.id },
    dedupeKey: `recall:${appt.id}`,
  });
  return true;
}

export async function handleRecallJob(job: Job): Promise<void | { skipped: string }> {
  const businessId = job.businessId;
  const { appointmentId } = job.payload as { appointmentId: string };
  if (!businessId) return { skipped: "no business" };
  const check = await withTenant(businessId, async (tx) => {
    const [appt] = await tx.select().from(appointments).where(and(eq(appointments.id, appointmentId), eq(appointments.businessId, businessId)));
    if (!appt || appt.status !== "completed") return { skip: "visit not completed" } as const;
    const [upcoming] = await tx
      .select({ id: appointments.id })
      .from(appointments)
      .where(and(eq(appointments.customerId, appt.customerId), inArray(appointments.status, ["pending", "confirmed"]), gt(appointments.startsAt, sql`now()`)))
      .limit(1);
    if (upcoming) return { skip: "already has an upcoming appointment" } as const;
    const [later] = await tx
      .select({ id: appointments.id })
      .from(appointments)
      .where(and(eq(appointments.customerId, appt.customerId), eq(appointments.serviceId, appt.serviceId), eq(appointments.status, "completed"), gt(appointments.startsAt, appt.startsAt)))
      .limit(1);
    if (later) return { skip: "a later visit exists" } as const;
    const [svc] = await tx.select().from(services).where(eq(services.id, appt.serviceId));
    return { appt, svc: svc! };
  });
  if ("skip" in check) return { skipped: check.skip ?? "skipped" };
  const res = await sendCustomerTemplate({
    businessId,
    customerId: check.appt.customerId,
    appointmentId: check.appt.id,
    template: "recall_reminder",
    variables: ({ locale, business, customer }) => [
      customer.name?.split(" ")[0] ?? "",
      pickLocalized(check.svc.name, locale),
      business.name,
      `${bookingUrl(business.slug)}?service=${check.svc.id}`,
    ],
  });
  if (res.status === "skipped") return { skipped: res.reason ?? "skipped" };
}
