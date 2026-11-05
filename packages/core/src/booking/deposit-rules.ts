/**
 * Deposit rules (no imports from booking/service to avoid cycles).
 * A public booking (booking page, WhatsApp, web chat, voice) needs a deposit when
 *  - the service requires one, or
 *  - the customer has ≥ `depositAfterNoShows` no-shows (repeat no-show protection).
 * The appointment is held as `pending` until the deposit is received; an
 * unpaid hold is auto-cancelled at `deposit_due_at` (DEPOSIT_EXPIRE_JOB).
 */
import { eq } from "drizzle-orm";
import type { Tx } from "../db/tenant";
import { payments, type Appointment, type Business, type Customer, type Locale, type Service } from "../db/schema";
import { hasFeature } from "../billing/features";
import { getPaymentsProvider } from "../providers/payments";
import { signValue } from "./tokens";
import { enqueueJob } from "../jobs/queue";
import { DEFAULT_BOOKING_SETTINGS } from "../db/schema";

export const DEPOSIT_EXPIRE_JOB = "deposit.expire";
export const DEPOSIT_TOKEN_PURPOSE = "deposit-pay";

export type DepositRequirement = { cents: number; reason: "service" | "no_shows" };

export function depositRequirement(
  business: Pick<Business, "planTier" | "featureFlags" | "bookingSettings">,
  service: Pick<Service, "depositRequired" | "depositCents" | "priceCents">,
  customer: Pick<Customer, "noShowCount"> | null,
): DepositRequirement | null {
  if (!hasFeature(business, "deposits")) return null;
  if (service.depositRequired && service.depositCents > 0) return { cents: service.depositCents, reason: "service" };
  const threshold = business.bookingSettings?.depositAfterNoShows ?? 0;
  if (threshold > 0 && customer && customer.noShowCount >= threshold) {
    // Service deposit if configured, else 30% of the price rounded up to $5 (min $10).
    const cents = service.depositCents > 0 ? service.depositCents : Math.max(1000, Math.ceil(((service.priceCents ?? 0) * 0.3) / 500) * 500);
    return { cents, reason: "no_shows" };
  }
  return null;
}

/** When the hold expires: `depositHoldHours` from now, but at least 1 h before the visit (and ≥ 30 min from now). */
export function depositDueAt(business: Pick<Business, "bookingSettings">, startsAt: Date, now = new Date()): Date {
  const hold = business.bookingSettings?.depositHoldHours ?? DEFAULT_BOOKING_SETTINGS.depositHoldHours;
  let due = Math.min(now.getTime() + hold * 3_600_000, startsAt.getTime() - 3_600_000);
  due = Math.max(due, now.getTime() + 30 * 60_000);
  return new Date(due);
}

export const depositReference = (appointmentId: string) => `D-${appointmentId.slice(0, 6).toUpperCase()}`;

const DEFAULT_INSTRUCTIONS: Record<Locale, string> = {
  ar: "فيك تدفع بالعيادة أو بتحويل Whish / OMT، وبس تدفع ردّ علينا هون.",
  en: "You can pay at the clinic or by Whish / OMT transfer — reply here once paid.",
  fr: "Vous pouvez payer au cabinet ou par transfert Whish / OMT — répondez ici une fois payé.",
};

export function depositInstructions(business: Pick<Business, "bookingSettings">, locale: Locale): string {
  return business.bookingSettings?.depositInstructions?.trim() || DEFAULT_INSTRUCTIONS[locale];
}

/** Create the pending payment (+ link when a payment-link provider is configured) and the expiry job. */
export async function createDepositHold(tx: Tx, appt: Appointment, dep: DepositRequirement, description: string) {
  const provider = getPaymentsProvider();
  const [pay] = await tx
    .insert(payments)
    .values({
      businessId: appt.businessId,
      appointmentId: appt.id,
      kind: "deposit",
      amountCents: dep.cents,
      method: provider.name === "manual" ? "other" : "payment_link",
      provider: provider.name,
      providerRef: depositReference(appt.id),
      status: "pending",
    })
    .returning();
  const link = await provider.createPaymentLink({
    purpose: "deposit",
    reference: signValue(pay!.id, DEPOSIT_TOKEN_PURPOSE),
    amountCents: dep.cents,
    description,
  });
  if (link.url) await tx.update(payments).set({ paymentUrl: link.url }).where(eq(payments.id, pay!.id));
  if (appt.depositDueAt) {
    await enqueueJob(tx, {
      type: DEPOSIT_EXPIRE_JOB,
      businessId: appt.businessId,
      runAt: appt.depositDueAt,
      payload: { appointmentId: appt.id },
      dedupeKey: `deposit-expire:${appt.id}`,
    });
  }
  return { paymentId: pay!.id, url: link.url };
}

export async function pendingDepositPayment(tx: Tx, appointmentId: string) {
  const rows = await tx.select().from(payments).where(eq(payments.appointmentId, appointmentId));
  return rows.find((p) => p.kind === "deposit" && p.status === "pending") ?? null;
}
