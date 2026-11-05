/**
 * Payments adapter. Lebanon has limited card acquiring, so the default is
 * MANUAL billing: Fekerte issues invoices and an admin marks them paid (cash,
 * bank transfer, local wallet transfer) with a reference and receipt.
 *
 * Hooks for real processors implement `PaymentsProvider` (e.g. a card gateway
 * or a wallet API) and are selected with PAYMENTS_PROVIDER. None is faked here:
 *  - "manual" (default): no link; customers get bank/wallet instructions.
 *  - "mock_link": returns a local fake checkout URL — for demos of the deposit
 *    flow only; it never charges anyone.
 */
import { config } from "../config";

export type PaymentLink = { url: string | null; reference: string; instructions: string | null };

export interface PaymentsProvider {
  readonly name: string;
  /** Create a way for a payer to pay `amountCents` (USD). */
  createPaymentLink(input: { purpose: "invoice" | "deposit"; reference: string; amountCents: number; description: string; customerPhone?: string | null }): Promise<PaymentLink>;
}

export function paymentInstructions(): string {
  return (
    process.env.PAYMENT_INSTRUCTIONS ??
    "Pay by bank transfer (IBAN on the invoice), cash at the clinic, or wallet transfer (Whish / OMT). Mention the reference."
  );
}

export class ManualPaymentsProvider implements PaymentsProvider {
  readonly name = "manual";
  async createPaymentLink(input: { reference: string }): Promise<PaymentLink> {
    return { url: null, reference: input.reference, instructions: paymentInstructions() };
  }
}

export class MockPaymentLinkProvider implements PaymentsProvider {
  readonly name = "mock_link";
  async createPaymentLink(input: { purpose: "invoice" | "deposit"; reference: string; amountCents: number }): Promise<PaymentLink> {
    return {
      url: `${config.appUrl}/pay/mock?ref=${encodeURIComponent(input.reference)}&amount=${input.amountCents}`,
      reference: input.reference,
      instructions: "Demo payment link (no money is charged).",
    };
  }
}

export function getPaymentsProvider(): PaymentsProvider {
  return process.env.PAYMENTS_PROVIDER === "mock_link" ? new MockPaymentLinkProvider() : new ManualPaymentsProvider();
}
