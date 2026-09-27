import "server-only";
import Stripe from "stripe";
export interface PaymentProvider {
  checkout(input: {
    org: string;
    lead: string;
    email: string | null;
    origin: string;
  }): Promise<string>;
}
export class StripeProvider implements PaymentProvider {
  async checkout(input: Parameters<PaymentProvider["checkout"]>[0]) {
    if (!process.env.STRIPE_SECRET_KEY || !process.env.STRIPE_PRICE_ID)
      throw new Error("Stripe neconfigurat.");
    const session = await new Stripe(
      process.env.STRIPE_SECRET_KEY,
    ).checkout.sessions.create(
      {
        mode: "payment",
        line_items: [{ price: process.env.STRIPE_PRICE_ID, quantity: 1 }],
        customer_email: input.email || undefined,
        metadata: { organization_id: input.org, lead_id: input.lead },
        success_url: `${input.origin}/payment/success`,
        cancel_url: `${input.origin}/payment/cancelled`,
      },
      {
        idempotencyKey: `checkout:${input.org}:${input.lead}:${Math.floor(Date.now() / 3600000)}`,
      },
    );
    if (!session.url) throw new Error("Link de plată indisponibil.");
    return session.url;
  }
}
// Netopia can implement PaymentProvider without changing the checkout workflow.
