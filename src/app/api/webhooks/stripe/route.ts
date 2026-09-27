import { NextRequest, NextResponse } from "next/server";
import Stripe from "stripe";
import { z } from "zod";
import { admin, check, enqueue } from "@/lib/db";
export async function POST(req: NextRequest) {
  if (!process.env.STRIPE_SECRET_KEY || !process.env.STRIPE_WEBHOOK_SECRET)
    return NextResponse.json({ error: "Neconfigurat" }, { status: 503 });
  let event: Stripe.Event;
  try {
    event = new Stripe(process.env.STRIPE_SECRET_KEY).webhooks.constructEvent(
      await req.text(),
      req.headers.get("stripe-signature") || "",
      process.env.STRIPE_WEBHOOK_SECRET,
    );
  } catch {
    return NextResponse.json({ error: "Semnătură invalidă" }, { status: 401 });
  }
  if (
    ![
      "checkout.session.completed",
      "checkout.session.async_payment_succeeded",
    ].includes(event.type)
  )
    return NextResponse.json({ ignored: true });
  const paid = event.data.object as Stripe.Checkout.Session;
  if (paid.payment_status !== "paid")
    return NextResponse.json({ ignored: true });
  const parsed = z
    .object({ organization_id: z.uuid(), lead_id: z.uuid() })
    .safeParse(paid.metadata);
  if (!parsed.success) return NextResponse.json({ ignored: true });
  try {
    const db = admin();
    check(
      await db
        .from("leads")
        .select("id")
        .eq("organization_id", parsed.data.organization_id)
        .eq("id", parsed.data.lead_id)
        .single(),
    );
    check(
      await db.from("webhook_events").upsert(
        {
          organization_id: parsed.data.organization_id,
          provider: "stripe",
          event_id: event.id,
          event_type: event.type,
          payload: {
            id: paid.id,
            amount_total: paid.amount_total,
            currency: paid.currency,
            metadata: parsed.data,
          },
        },
        { onConflict: "provider,event_id", ignoreDuplicates: true },
      ),
    );
    const row = check(
      await db
        .from("webhook_events")
        .select("id")
        .eq("provider", "stripe")
        .eq("event_id", event.id)
        .single(),
    );
    await enqueue(
      parsed.data.organization_id,
      "sync_payment_events",
      `payment:${event.id}`,
      parsed.data.lead_id,
      { event_id: row.id },
    );
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json(
      { error: "Procesarea va fi reîncercată." },
      { status: 500 },
    );
  }
}
