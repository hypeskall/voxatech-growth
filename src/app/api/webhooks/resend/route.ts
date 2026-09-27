import { NextRequest, NextResponse } from "next/server";
import { Resend } from "resend";
import { z } from "zod";
import { admin, check, enqueue, log } from "@/lib/db";
export async function POST(req: NextRequest) {
  if (!process.env.RESEND_API_KEY || !process.env.RESEND_WEBHOOK_SECRET)
    return NextResponse.json({ error: "Neconfigurat" }, { status: 503 });
  const resend = new Resend(process.env.RESEND_API_KEY);
  const raw = await req.text();
  let event;
  try {
    event = resend.webhooks.verify({
      payload: raw,
      headers: {
        id: req.headers.get("svix-id") || "",
        timestamp: req.headers.get("svix-timestamp") || "",
        signature: req.headers.get("svix-signature") || "",
      },
      webhookSecret: process.env.RESEND_WEBHOOK_SECRET,
    });
  } catch {
    return NextResponse.json({ error: "Semnătură invalidă" }, { status: 401 });
  }
  try {
    const db = admin();
    const payload = z
      .object({
        type: z.string(),
        data: z.object({ email_id: z.string() }).passthrough(),
      })
      .parse(event);
    if (payload.type === "email.received") {
      const received = await resend.emails.receiving.get(payload.data.email_id);
      if (received.error || !received.data)
        throw new Error("Mesajul nu poate fi preluat.");
      const mail = received.data;
      const recipients = [...(mail.to || []), ...(mail.received_for || [])];
      let replyToken: string | null = null;
      for (const address of recipients) {
        const match = address.match(/reply\+([a-f0-9-]{36})@/i);
        if (match) {
          replyToken = match[1];
          break;
        }
      }
      if (!replyToken)
        return NextResponse.json({ ignored: "unmatched_recipient" });
      const { data: parent, error } = await db
        .from("messages")
        .select("*")
        .eq("reply_token", replyToken)
        .maybeSingle();
      if (error) throw error;
      if (!parent) return NextResponse.json({ ignored: "unknown_thread" });
      const lead = check(
        await db.from("leads").select("*").eq("id", parent.lead_id).single(),
      );
      const from = mail.from.match(/<([^>]+)>/)?.[1] || mail.from;
      if (from.toLowerCase().trim() !== lead.email?.toLowerCase().trim()) {
        await log(parent.organization_id, "inbound_sender_mismatch", lead.id);
        return NextResponse.json({ ignored: "sender_mismatch" });
      }
      const eventId = req.headers.get("svix-id")!;
      const prior = check(
        await db
          .from("webhook_events")
          .select("processed_at")
          .eq("provider", "resend")
          .eq("event_id", eventId)
          .maybeSingle(),
      );
      if (prior?.processed_at)
        return NextResponse.json({ ignored: "duplicate_event" });
      check(
        await db.from("webhook_events").upsert(
          {
            organization_id: parent.organization_id,
            provider: "resend",
            event_id: eventId,
            event_type: payload.type,
            payload: JSON.parse(raw),
          },
          { onConflict: "provider,event_id", ignoreDuplicates: true },
        ),
      );
      const conv = check(
        await db
          .from("conversations")
          .upsert(
            {
              organization_id: parent.organization_id,
              lead_id: lead.id,
              channel: "email",
            },
            { onConflict: "organization_id,lead_id,channel" },
          )
          .select()
          .single(),
      );
      check(
        await db.from("messages").upsert(
          {
            organization_id: parent.organization_id,
            lead_id: lead.id,
            conversation_id: conv.id,
            direction: "inbound",
            status: "received",
            provider: "resend",
            provider_message_id: payload.data.email_id,
            idempotency_key: `inbound:${payload.data.email_id}`,
            subject: mail.subject,
            body: (
              mail.text ||
              "Conținut text indisponibil. Necesită intervenție umană."
            ).slice(0, 20000),
            received_at: new Date().toISOString(),
          },
          {
            onConflict: "organization_id,idempotency_key",
            ignoreDuplicates: true,
          },
        ),
      );
      const message = check(
        await db
          .from("messages")
          .select("id")
          .eq("organization_id", parent.organization_id)
          .eq("idempotency_key", `inbound:${payload.data.email_id}`)
          .single(),
      );
      await enqueue(
        parent.organization_id,
        "process_inbound_replies",
        `inbound:${message.id}`,
        lead.id,
        { message_id: message.id },
      );
      if (
        ![
          "QUALIFIED",
          "DEMO_GENERATING",
          "DEMO_SENT",
          "TRIAL",
          "CHECKOUT_SENT",
          "WON",
          "LOST",
          "HUMAN_REQUIRED",
          "DO_NOT_CONTACT",
        ].includes(lead.status)
      )
        check(
          await db
            .from("leads")
            .update({ status: "REPLIED", next_action_at: null })
            .eq("id", lead.id)
            .eq("organization_id", parent.organization_id)
            .eq("status", lead.status)
            .eq("do_not_contact", false),
        );
      check(
        await db
          .from("campaign_leads")
          .update({
            stopped_at: new Date().toISOString(),
            stop_reason: "reply",
            next_action_at: null,
          })
          .eq("organization_id", parent.organization_id)
          .eq("lead_id", lead.id),
      );
      check(
        await db
          .from("webhook_events")
          .update({ processed_at: new Date().toISOString(), error: null })
          .eq("provider", "resend")
          .eq("event_id", eventId),
      );
    } else {
      const { data: m, error } = await db
        .from("messages")
        .select("*")
        .eq("provider", "resend")
        .eq("provider_message_id", payload.data.email_id)
        .maybeSingle();
      if (error) throw error;
      if (!m) return NextResponse.json({ ignored: "unknown_message" });
      const key = req.headers.get("svix-id")!;
      check(
        await db.from("webhook_events").upsert(
          {
            organization_id: m.organization_id,
            provider: "resend",
            event_id: key,
            event_type: payload.type,
            payload: JSON.parse(raw),
          },
          { onConflict: "provider,event_id", ignoreDuplicates: true },
        ),
      );
      const status: Record<
        string,
        "sent" | "delivered" | "opened" | "bounced" | "failed"
      > = {
        "email.sent": "sent",
        "email.delivered": "delivered",
        "email.opened": "opened",
        "email.bounced": "bounced",
        "email.failed": "failed",
      };
      if (
        ["email.bounced", "email.complained", "email.suppressed"].includes(
          payload.type,
        )
      )
        check(
          await db.rpc("suppress_lead", {
            org: m.organization_id,
            target: m.lead_id,
            reason_text: payload.type,
          }),
        );
      const next = status[payload.type];
      const rank: Record<string, number> = {
        sending: 0,
        sent: 1,
        delivered: 2,
        opened: 3,
        failed: 4,
        bounced: 5,
      };
      if (next && (rank[next] ?? 0) > (rank[m.status] ?? 0))
        check(
          await db.from("messages").update({ status: next }).eq("id", m.id),
        );
      check(
        await db
          .from("webhook_events")
          .update({ processed_at: new Date().toISOString() })
          .eq("provider", "resend")
          .eq("event_id", key),
      );
    }
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json(
      { error: "Procesarea va fi reîncercată." },
      { status: 500 },
    );
  }
}
