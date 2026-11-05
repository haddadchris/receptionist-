/**
 * Deposit lifecycle: staff mark received (cash / transfer / wallet + reference)
 * or waive; a payment-link provider can mark paid; unpaid holds auto-cancel.
 */
import { and, eq } from "drizzle-orm";
import { withTenant } from "../db/tenant";
import { appointments, payments, type Job } from "../db/schema";
import { cancelBooking, setAppointmentStatus } from "../booking/service";
import { DEPOSIT_EXPIRE_JOB, pendingDepositPayment } from "../booking/deposit-rules";
import { cancelAppointmentJobs } from "../jobs/queue";
import { audit, type Actor } from "../lib/audit";
import { DomainError } from "../lib/errors";
import type { Tx } from "../db/tenant";

type Method = "cash" | "bank_transfer" | "wallet" | "card" | "payment_link" | "other";

async function loadRequired(tx: Tx, businessId: string, appointmentId: string) {
  const [appt] = await tx.select().from(appointments).where(and(eq(appointments.id, appointmentId), eq(appointments.businessId, businessId)));
  if (!appt) throw new DomainError("NOT_FOUND", "Appointment not found");
  return appt;
}

export async function markDepositPaid(tx: Tx, businessId: string, appointmentId: string, input: { method: Method; reference?: string | null; actor: Actor }) {
  const appt = await loadRequired(tx, businessId, appointmentId);
  if (appt.depositStatus === "paid") return appt;
  if (appt.status === "cancelled") throw new DomainError("CONFLICT", "Appointment is cancelled");
  if (appt.depositStatus !== "required") throw new DomainError("CONFLICT", "No deposit is required for this appointment");
  const pending = await pendingDepositPayment(tx, appt.id);
  if (pending) {
    await tx.update(payments).set({ status: "succeeded", method: input.method, providerRef: input.reference || pending.providerRef }).where(eq(payments.id, pending.id));
  } else {
    await tx.insert(payments).values({
      businessId,
      appointmentId: appt.id,
      kind: "deposit",
      amountCents: appt.depositCents,
      method: input.method,
      provider: "manual",
      providerRef: input.reference ?? null,
      status: "succeeded",
    });
  }
  await tx.update(appointments).set({ depositStatus: "paid" }).where(eq(appointments.id, appt.id));
  await cancelAppointmentJobs(tx, appt.id, [DEPOSIT_EXPIRE_JOB]);
  await audit(tx, { businessId, actor: input.actor, action: "deposit.paid", entityType: "appointment", entityId: appt.id, changes: { method: input.method, reference: input.reference, cents: appt.depositCents } });
  // A paid deposit confirms the hold; pending → confirmed sends the confirmation message.
  if (appt.status === "pending") return setAppointmentStatus(tx, businessId, appt.id, "confirmed", input.actor);
  return loadRequired(tx, businessId, appt.id);
}

export async function waiveDeposit(tx: Tx, businessId: string, appointmentId: string, actor: Actor) {
  const appt = await loadRequired(tx, businessId, appointmentId);
  if (appt.depositStatus !== "required") throw new DomainError("CONFLICT", "No deposit is required for this appointment");
  const pending = await pendingDepositPayment(tx, appt.id);
  if (pending) await tx.update(payments).set({ status: "failed" }).where(eq(payments.id, pending.id));
  await tx.update(appointments).set({ depositStatus: "waived" }).where(eq(appointments.id, appt.id));
  await cancelAppointmentJobs(tx, appt.id, [DEPOSIT_EXPIRE_JOB]);
  await audit(tx, { businessId, actor, action: "deposit.waived", entityType: "appointment", entityId: appt.id });
  if (appt.status === "pending") return setAppointmentStatus(tx, businessId, appt.id, "confirmed", actor);
  return loadRequired(tx, businessId, appt.id);
}

/** Job: release the slot if the deposit still hasn't arrived. */
export async function handleDepositExpireJob(job: Job): Promise<void | { skipped: string }> {
  const { appointmentId } = job.payload as { appointmentId: string };
  if (!job.businessId) return { skipped: "no business" };
  const businessId = job.businessId;
  return withTenant(businessId, async (tx) => {
    const appt = await loadRequired(tx, businessId, appointmentId).catch(() => null);
    if (!appt) return { skipped: "appointment not found" };
    if (appt.depositStatus !== "required" || appt.status === "cancelled") return { skipped: "deposit settled" };
    if (appt.depositDueAt && appt.depositDueAt.getTime() > Date.now() + 30_000) return { skipped: "not due yet" };
    const pending = await pendingDepositPayment(tx, appt.id);
    if (pending) await tx.update(payments).set({ status: "failed" }).where(eq(payments.id, pending.id));
    await cancelBooking(tx, businessId, appt.id, { actor: { type: "system", label: "deposit not received" }, reason: "Deposit not received in time" });
  });
}

export { DEPOSIT_EXPIRE_JOB };
