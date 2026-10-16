import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { session } from "@/lib/session";
import { admin, check, enqueue, log, appUrl, safeError } from "@/lib/db";
import {
  leadInput,
  campaignInput,
  statuses,
  normalizePhone,
  categories,
} from "@/lib/domain";
import { StripeProvider } from "@/lib/providers/payment";
import {
  regenerateReviewDraft,
  runAiEvaluationBatch,
  runControlledAiTest,
} from "@/lib/automation";
import {
  email,
  sendOrganizationInternalTest,
  verifyResendSenderDomain,
} from "@/lib/providers/email";
import { gmailAccount } from "@/lib/providers/gmail";
import { gmailConfigurationReady } from "@/lib/gmail-security";
import {
  internalTestRecipient,
  internalTestRequest,
} from "@/lib/internal-test-email";
import { evaluateLaunchReadiness, validProspectEmail } from "@/lib/launch";
export const maxDuration = 300;
const envelope = z.object({ action: z.string(), data: z.unknown() });
const idsSchema = z.object({
  ids: z.array(z.uuid()).min(1).max(500),
  status: z.enum(statuses).optional(),
  campaign_id: z.uuid().optional(),
});

function metadataObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

async function campaignLaunchReadiness(
  organizationId: string,
  campaignId: string,
  confirmation?: string,
) {
  const root = admin();
  const campaign = check(
    await root
      .from("campaigns")
      .select("*")
      .eq("organization_id", organizationId)
      .eq("id", campaignId)
      .single(),
  );
  const memberships = check(
    await root
      .from("campaign_leads")
      .select("lead_id")
      .eq("organization_id", organizationId)
      .eq("campaign_id", campaignId)
      .is("stopped_at", null),
  );
  const leadIds = memberships.map((item) => item.lead_id);
  const leads = leadIds.length
    ? check(
        await root
          .from("leads")
          .select("id,email")
          .eq("organization_id", organizationId)
          .in("id", leadIds),
      )
    : [];
  const messages = check(
    await root
      .from("messages")
      .select("lead_id,body,status,metadata")
      .eq("organization_id", organizationId)
      .eq("campaign_id", campaignId)
      .eq("direction", "outbound"),
  );
  const recommended = leadIds.flatMap((leadId) => {
    const found = messages.find((message) => {
      const metadata = metadataObject(message.metadata);
      return message.lead_id === leadId && metadata.outreach_variant === "B";
    });
    return found ? [found] : [];
  });
  const integration = check(
    await root
      .from("integrations")
      .select("public_config,last_verified_at")
      .eq("organization_id", organizationId)
      .eq("provider", "resend")
      .maybeSingle(),
  );
  const publicConfig = metadataObject(integration?.public_config);
  const configuredFrom = process.env.RESEND_FROM_EMAIL || "";
  const fromAddress = configuredFrom.match(/<([^>]+)>/)?.[1] || configuredFrom;
  const fromDomain = fromAddress.toLowerCase().split("@")[1] || "";
  const campaignSenderDomain = (campaign.sender_identity || "")
    .toLowerCase()
    .split("@")[1];
  const connectedGmail = await gmailAccount(
    organizationId,
    campaign.sender_identity || "",
  );
  const senderVerified = connectedGmail
    ? gmailConfigurationReady() && connectedGmail.status === "connected"
    : !!process.env.RESEND_API_KEY &&
      !!process.env.RESEND_FROM_EMAIL &&
      !!integration?.last_verified_at &&
      publicConfig.sender_domain_verified === true &&
      publicConfig.sender_domain === fromDomain &&
      validProspectEmail(campaign.sender_identity || "") &&
      campaignSenderDomain === fromDomain;
  const readiness = evaluateLaunchReadiness({
    senderVerified,
    recipients: leads,
    drafts: recommended.map((message) => ({
      approved: message.status === "approved",
      body: message.body,
    })),
    dailyCap: campaign.daily_cap,
    confirmation,
    liveMode: process.env.EMAIL_DELIVERY_MODE === "live",
  });
  return { campaign, readiness, recipientCount: leads.length };
}
export async function POST(req: NextRequest) {
  if (req.headers.get("origin") !== new URL(appUrl()).origin)
    return NextResponse.json({ error: "Origine nepermisă." }, { status: 403 });
  try {
    const s = await session();
    if (!s)
      return NextResponse.json(
        { error: "Autentificare necesară." },
        { status: 401 },
      );
    const raw = await req.text();
    if (raw.length > 1500000)
      return NextResponse.json({ error: "Date prea mari." }, { status: 413 });
    const { action, data } = envelope.parse(JSON.parse(raw));
    if (["checkout", "demo", "send_demo", "whatsapp_template"].includes(action))
      return NextResponse.json(
        { error: "Această integrare a fost retrasă din Voxa." },
        { status: 410 },
      );
    const db = s.db;
    const root = admin();
    const manager = ["owner", "admin"].includes(s.role);
    if (s.role === "viewer" && !["password", "logout"].includes(action))
      throw new Error("Rolul de vizualizare nu permite modificări.");
    if (
      [
        "campaign_save",
        "lead_delete",
        "lead_restore",
        "campaign_status",
        "knowledge_save",
        "knowledge_delete",
        "settings_save",
        "integration_toggle",
        "retry_job",
        "ai_controlled_test",
        "ai_evaluation_batch",
        "message_approve",
        "message_reject",
        "message_regenerate",
        "message_test",
        "resend_verify_sender",
      ].includes(action) &&
      !manager
    )
      throw new Error("Este necesar rolul de administrator.");
    let result: unknown = { ok: true };
    switch (action) {
      case "lead_delete":
      case "lead_restore": {
        const input = idsSchema.parse(data);
        result = {
          affected: check(
            await root.rpc(
              action === "lead_delete" ? "trash_leads" : "restore_leads",
              { org: s.org, targets: input.ids, actor: s.user.id },
            ),
          ),
        };
        break;
      }
      case "ai_controlled_test": {
        z.object({}).parse(data);
        result = await runControlledAiTest(s.org, s.user.id);
        break;
      }
      case "ai_evaluation_batch": {
        const input = z
          .object({ ids: z.array(z.uuid()).min(1).max(10) })
          .parse(data);
        result = await runAiEvaluationBatch(s.org, s.user.id, input.ids);
        break;
      }
      case "lead_save": {
        const input = z
          .object({ id: z.uuid().optional(), lead: leadInput })
          .parse(data);
        const cleaned = {
          ...input.lead,
          ...(input.lead.website !== undefined
            ? { website: input.lead.website || null }
            : {}),
          ...(input.lead.email !== undefined
            ? { email: input.lead.email?.toLowerCase() || null }
            : {}),
          ...(input.lead.phone !== undefined
            ? { phone: normalizePhone(input.lead.phone) }
            : {}),
        };
        if (input.id)
          result = check(
            await db
              .from("leads")
              .update(cleaned)
              .eq("id", input.id)
              .eq("organization_id", s.org)
              .is("deleted_at", null)
              .select()
              .single(),
          );
        else {
          const row = check(
            await db
              .from("leads")
              .insert({ ...cleaned, organization_id: s.org })
              .select()
              .single(),
          );
          await enqueue(
            s.org,
            "enrich_new_leads",
            `enrich:${row.id}:initial`,
            row.id,
          );
          result = row;
        }
        break;
      }
      case "import": {
        const envelope = z
          .union([
            z.array(leadInput).max(500),
            z.object({
              rows: z.array(leadInput).max(500),
              lead_list_id: z.uuid(),
            }),
          ])
          .parse(data);
        const input = Array.isArray(envelope) ? envelope : envelope.rows;
        const listId = Array.isArray(envelope) ? null : envelope.lead_list_id;
        if (listId)
          check(
            await db
              .from("lead_lists")
              .select("id")
              .eq("organization_id", s.org)
              .eq("id", listId)
              .single(),
          );
        const errors: { row: number; error: string }[] = [];
        const inserted_ids: string[] = [];
        let inserted = 0;
        for (let i = 0; i < input.length; i++) {
          const item = input[i];
          const r = await db
            .from("leads")
            .insert({
              ...item,
              organization_id: s.org,
              lead_list_id: listId,
              email: item.email?.toLowerCase() || null,
              website: item.website || null,
              phone: normalizePhone(item.phone),
            })
            .select()
            .single();
          if (r.error) {
            errors.push({
              row: i + 1,
              error:
                r.error.code === "23505"
                  ? "Duplicat"
                  : "Date invalide sau asociere nepermisă",
            });
            continue;
          }
          inserted++;
          inserted_ids.push(r.data.id);
          if (!listId)
            await enqueue(
              s.org,
              "enrich_new_leads",
              `enrich:${r.data.id}:initial`,
              r.data.id,
            );
        }
        result = { inserted, inserted_ids, errors };
        break;
      }
      case "lead_list_create": {
        const input = z
          .object({
            name: z.string().trim().min(2).max(160),
            niche: z.string().trim().max(100).default(""),
          })
          .parse(data);
        result = check(
          await db
            .from("lead_lists")
            .insert({ ...input, organization_id: s.org })
            .select()
            .single(),
        );
        break;
      }
      case "lead_list_assign": {
        const input = z
          .object({
            ids: z.array(z.uuid()).min(1).max(5000),
            lead_list_id: z.uuid().nullable(),
          })
          .parse(data);
        if (input.lead_list_id)
          check(
            await db
              .from("lead_lists")
              .select("id")
              .eq("organization_id", s.org)
              .eq("id", input.lead_list_id)
              .single(),
          );
        result = check(
          await db
            .from("leads")
            .update({ lead_list_id: input.lead_list_id })
            .eq("organization_id", s.org)
            .in("id", input.ids)
            .is("deleted_at", null)
            .select("id"),
        );
        break;
      }
      case "bulk_status":
      case "bulk_campaign":
      case "bulk_enrich":
      case "bulk_draft":
      case "bulk_queue":
      case "demo":
      case "send_demo":
      case "human":
      case "suppress": {
        const input = idsSchema.parse(data);
        const leads = check(
          await db
            .from("leads")
            .select("*")
            .eq("organization_id", s.org)
            .in("id", input.ids)
            .is("deleted_at", null),
        );
        if (leads.length !== input.ids.length)
          throw new Error("Prospect inaccesibil.");
        if (input.campaign_id) {
          const campaign = check(
            await db
              .from("campaigns")
              .select("*")
              .eq("id", input.campaign_id)
              .eq("organization_id", s.org)
              .single(),
          );
          const filters = z
            .object({
              min_score: z.string().optional(),
              source: z.string().optional(),
            })
            .parse(campaign.target_filters);
          if (
            leads.some(
              (l) =>
                (campaign.niche &&
                  l.niche?.toLowerCase() !== campaign.niche.toLowerCase()) ||
                (campaign.cities.length &&
                  !campaign.cities.some(
                    (c) => c.toLowerCase() === l.city?.toLowerCase(),
                  )) ||
                Number(filters.min_score || 0) > (l.lead_score || 0) ||
                (filters.source && l.source !== filters.source),
            )
          )
            throw new Error(
              "Selecția include prospecte care nu corespund audienței campaniei. Ajustează filtrele sau selecția.",
            );
        }
        const isStopping =
          action === "suppress" ||
          (action === "bulk_status" && input.status === "DO_NOT_CONTACT");
        if (!isStopping && leads.some((lead) => lead.do_not_contact))
          throw new Error(
            "Selecția include un prospect aflat pe lista de suprimare.",
          );
        if (["bulk_campaign", "bulk_queue"].includes(action)) {
          if (!input.campaign_id) throw new Error("Selectează o campanie.");
          check(
            await root.rpc("assign_leads_to_campaign", {
              org: s.org,
              target_campaign: input.campaign_id,
              target_leads: input.ids,
            }),
          );
        }
        for (const lead of leads) {
          if (
            action === "suppress" ||
            (action === "bulk_status" && input.status === "DO_NOT_CONTACT")
          ) {
            check(
              await root.rpc("suppress_lead", {
                org: s.org,
                target: lead.id,
                reason_text: "Oprit manual de echipă",
              }),
            );
            continue;
          }
          if (action === "bulk_status") {
            if (!input.status) throw new Error("Status lipsă.");
            check(
              await db
                .from("leads")
                .update({ status: input.status })
                .eq("id", lead.id)
                .eq("organization_id", s.org),
            );
          }
          if (action === "human") {
            check(
              await db
                .from("leads")
                .update({ status: "HUMAN_REQUIRED" })
                .eq("id", lead.id),
            );
            const existing = check(
              await db
                .from("tasks")
                .select("id")
                .eq("lead_id", lead.id)
                .in("status", ["open", "in_progress"]),
            );
            let taskId = existing[0]?.id;
            if (!taskId)
              taskId = check(
                await db
                  .from("tasks")
                  .insert({
                    organization_id: s.org,
                    lead_id: lead.id,
                    title: "Intervenție umană necesară",
                  })
                  .select("id")
                  .single(),
              ).id;
            await enqueue(
              s.org,
              "notify_human_required",
              `human:${lead.id}:${taskId}`,
              lead.id,
            );
          }
          const kind =
            action === "bulk_enrich"
              ? "enrich_new_leads"
              : ["bulk_draft", "bulk_queue"].includes(action)
                ? "create_outreach_drafts"
                : ["demo", "send_demo"].includes(action)
                  ? "generate_requested_demos"
                  : null;
          if (kind)
            await enqueue(
              s.org,
              kind,
              `${action}:${lead.id}:${crypto.randomUUID()}`,
              lead.id,
              {
                ...(input.campaign_id
                  ? { campaign_id: input.campaign_id }
                  : {}),
                send: action === "send_demo",
              },
            );
        }
        break;
      }
      case "campaign_save": {
        const input = z
          .object({ id: z.uuid().optional(), campaign: campaignInput })
          .parse(data);
        if (input.id) {
          const previous = check(
            await db
              .from("campaigns")
              .select("sender_identity,status")
              .eq("organization_id", s.org)
              .eq("id", input.id)
              .single(),
          );
          if (
            previous.sender_identity !== input.campaign.sender_identity &&
            (previous.status === "active" ||
              check(
                await db
                  .from("messages")
                  .select("id")
                  .eq("organization_id", s.org)
                  .eq("campaign_id", input.id)
                  .eq("status", "sending")
                  .limit(1),
              ).length)
          )
            throw new Error(
              "Pune campania în pauză și verifică trimiterile în curs înainte de schimbarea expeditorului.",
            );
        }
        result = input.id
          ? check(
              await db
                .from("campaigns")
                .update(input.campaign)
                .eq("id", input.id)
                .eq("organization_id", s.org)
                .select()
                .single(),
            )
          : check(
              await db
                .from("campaigns")
                .insert({ ...input.campaign, organization_id: s.org })
                .select()
                .single(),
            );
        break;
      }
      case "campaign_status": {
        const input = z
          .object({
            id: z.uuid(),
            status: z.enum(["active", "paused", "archived"]),
            confirmation: z.string().optional(),
          })
          .parse(data);
        if (
          input.status === "active" &&
          process.env.EMAIL_DELIVERY_MODE === "live"
        ) {
          const { readiness } = await campaignLaunchReadiness(
            s.org,
            input.id,
            input.confirmation,
          );
          if (!readiness.ready) {
            const missing = Object.entries(readiness)
              .filter(([key, value]) => key !== "ready" && !value)
              .map(([key]) => key)
              .join(", ");
            throw new Error(
              `Lansarea este blocată. Verificări incomplete: ${missing}.`,
            );
          }
        }
        check(
          await db
            .from("campaigns")
            .update({ status: input.status })
            .eq("id", input.id)
            .eq("organization_id", s.org)
            .select()
            .single(),
        );
        await log(
          s.org,
          `campaign_${input.status}`,
          null,
          { campaign_id: input.id },
          null,
          s.user.id,
        );
        break;
      }
      case "message_save":
      case "message_approve": {
        const input = z
          .object({
            id: z.uuid(),
            body: z.string().min(1).max(20000).optional(),
            subject: z
              .string()
              .max(300)
              .refine(
                (value) => !/[\r\n]/.test(value),
                "Subiectul trebuie să fie pe un singur rând.",
              )
              .optional(),
          })
          .parse(data);
        const m = check(
          await db
            .from("messages")
            .select("*")
            .eq("id", input.id)
            .eq("organization_id", s.org)
            .single(),
        );
        if (
          !["draft", "approved", "queued"].includes(m.status) ||
          m.direction !== "outbound"
        )
          throw new Error("Mesajul nu mai poate fi modificat.");
        const messageMetadata =
          m.metadata &&
          typeof m.metadata === "object" &&
          !Array.isArray(m.metadata)
            ? m.metadata
            : {};
        const isReviewVariant =
          action === "message_approve" &&
          ["A", "B"].includes(String(messageMetadata.outreach_variant || ""));
        const updatedMessage = await root
          .from("messages")
          .update(
            action === "message_approve"
              ? {
                  status: "approved",
                  approved_by: s.user.id,
                  approved_at: new Date().toISOString(),
                  follow_up_number: isReviewVariant ? 0 : m.follow_up_number,
                  metadata: {
                    ...messageMetadata,
                    human_approved: true,
                    review_state: "approved",
                  },
                }
              : {
                  body: input.body || m.body,
                  subject: input.subject ?? m.subject,
                  status: "draft",
                  approved_by: null,
                  approved_at: null,
                  metadata: {
                    ...messageMetadata,
                    review_state: "draft",
                    human_approved: false,
                  },
                },
          )
          .eq("id", m.id)
          .eq("organization_id", s.org)
          .eq("status", m.status)
          .eq("updated_at", m.updated_at)
          .select("id")
          .single();
        if (updatedMessage.error)
          throw new Error(
            "Mesajul s-a schimbat sau a început să fie trimis. Actualizează istoricul înainte de modificare.",
          );
        check(updatedMessage);
        if (isReviewVariant && m.campaign_id) {
          check(
            await root
              .from("messages")
              .update({ status: "cancelled", follow_up_number: null })
              .eq("organization_id", s.org)
              .eq("lead_id", m.lead_id)
              .eq("campaign_id", m.campaign_id)
              .eq("direction", "outbound")
              .neq("id", m.id)
              .in("status", ["draft", "approved", "queued"]),
          );
        }
        if (action === "message_approve") {
          const campaign = m.campaign_id
            ? check(
                await root
                  .from("campaigns")
                  .select("status")
                  .eq("organization_id", s.org)
                  .eq("id", m.campaign_id)
                  .single(),
              )
            : null;
          if (!campaign || campaign.status === "active")
            await enqueue(
              s.org,
              "send_due_messages",
              `send:${process.env.EMAIL_DELIVERY_MODE === "live" ? "live" : "log"}:${m.id}`,
              m.lead_id,
              { message_id: m.id },
            );
        }
        await log(
          s.org,
          action,
          m.lead_id,
          { message_id: m.id },
          null,
          s.user.id,
        );
        break;
      }
      case "message_reject": {
        const input = z
          .object({ id: z.uuid(), note: z.string().max(2000).optional() })
          .parse(data);
        const message = check(
          await root
            .from("messages")
            .select("*")
            .eq("organization_id", s.org)
            .eq("id", input.id)
            .single(),
        );
        if (
          message.direction !== "outbound" ||
          message.sent_at ||
          !["draft", "approved", "queued"].includes(message.status)
        )
          throw new Error("Mesajul nu mai poate fi respins.");
        const metadata = metadataObject(message.metadata);
        const rejectedMessage = await root
          .from("messages")
          .update({
            status: "draft",
            approved_by: null,
            approved_at: null,
            metadata: {
              ...metadata,
              review_state: "rejected",
              human_approved: false,
              internal_note: input.note ?? String(metadata.internal_note || ""),
            },
          })
          .eq("organization_id", s.org)
          .eq("id", message.id)
          .eq("status", message.status)
          .eq("updated_at", message.updated_at)
          .select("id")
          .single();
        if (rejectedMessage.error)
          throw new Error(
            "Mesajul s-a schimbat sau a început să fie trimis. Actualizează istoricul înainte de respingere.",
          );
        check(rejectedMessage);
        await log(
          s.org,
          "message_reject",
          message.lead_id,
          { message_id: message.id, campaign_id: message.campaign_id },
          null,
          s.user.id,
        );
        break;
      }
      case "message_note": {
        const input = z
          .object({ id: z.uuid(), note: z.string().max(2000) })
          .parse(data);
        const message = check(
          await root
            .from("messages")
            .select("lead_id,metadata")
            .eq("organization_id", s.org)
            .eq("id", input.id)
            .single(),
        );
        check(
          await root
            .from("messages")
            .update({
              metadata: {
                ...metadataObject(message.metadata),
                internal_note: input.note,
              },
            })
            .eq("organization_id", s.org)
            .eq("id", input.id),
        );
        await log(
          s.org,
          "message_note",
          message.lead_id,
          { message_id: input.id },
          null,
          s.user.id,
        );
        break;
      }
      case "message_regenerate": {
        const input = z.object({ id: z.uuid() }).parse(data);
        result = await regenerateReviewDraft(s.org, s.user.id, input.id);
        break;
      }
      case "message_test": {
        const input = internalTestRequest.parse(data);
        const message = check(
          await root
            .from("messages")
            .select("*")
            .eq("organization_id", s.org)
            .eq("id", input.id)
            .single(),
        );
        const metadata = metadataObject(message.metadata);
        if (
          message.direction !== "outbound" ||
          !["draft", "approved", "queued"].includes(message.status)
        )
          throw new Error(
            "Testul este disponibil numai pentru o ciornă activă.",
          );
        const internalRecipient = internalTestRecipient(
          process.env.INTERNAL_TEST_EMAIL,
        );
        const matchingProspects = check(
          await root
            .from("leads")
            .select("id")
            .eq("organization_id", s.org)
            .eq("normalized_email", internalRecipient)
            .limit(1),
        );
        if (matchingProspects.length)
          throw new Error(
            "Adresa internă de test apare la un prospect și nu poate fi folosită.",
          );
        let sent: Awaited<ReturnType<typeof email.sendInternalTest>>;
        const campaignFrom = message.campaign_id
          ? check(
              await root
                .from("campaigns")
                .select("sender_identity")
                .eq("organization_id", s.org)
                .eq("id", message.campaign_id)
                .single(),
            ).sender_identity
          : null;
        try {
          sent = await sendOrganizationInternalTest(s.org, campaignFrom, {
            subject: message.subject || "Ciornă Voxa",
            text: message.body,
            key: `review-test:${message.id}:${message.updated_at}`,
          });
        } catch (error) {
          await log(
            s.org,
            "message_test_failed",
            message.lead_id,
            {
              message_id: message.id,
              campaign_id: message.campaign_id,
              recipient: "internal_test_email",
              result: "failed",
              error: safeError(error),
            },
            null,
            s.user.id,
          );
          throw error;
        }
        const sentAt = new Date().toISOString();
        check(
          await root
            .from("messages")
            .update({
              metadata: {
                ...metadata,
                review_state: "test_sent",
                last_test_sent_at: sentAt,
                last_test_provider_id: sent.id,
              },
            })
            .eq("organization_id", s.org)
            .eq("id", message.id),
        );
        await log(
          s.org,
          "message_test_sent",
          message.lead_id,
          {
            message_id: message.id,
            campaign_id: message.campaign_id,
            recipient: "internal_test_email",
            result: "sent",
            provider_mode: sent.mode,
            provider_id: sent.id,
          },
          null,
          s.user.id,
        );
        result = { sent: true, recipient: "internal_test_email" };
        break;
      }
      case "resend_verify_sender": {
        z.object({}).parse(data);
        const verified = await verifyResendSenderDomain();
        const integration = check(
          await root
            .from("integrations")
            .select("public_config")
            .eq("organization_id", s.org)
            .eq("provider", "resend")
            .single(),
        );
        check(
          await root
            .from("integrations")
            .update({
              enabled: verified.verified,
              last_verified_at: verified.verified
                ? new Date().toISOString()
                : null,
              public_config: {
                ...metadataObject(integration.public_config),
                sender_domain: verified.senderDomain,
                sender_domain_verified: verified.verified,
                provider_domain_id: verified.providerDomainId,
                provider_status: verified.providerStatus,
                checked_at: new Date().toISOString(),
              },
            })
            .eq("organization_id", s.org)
            .eq("provider", "resend"),
        );
        result = verified;
        break;
      }
      case "message_reply": {
        const input = z
          .object({
            lead_id: z.uuid(),
            body: z.string().min(1).max(20000),
            inbound_id: z.uuid().optional(),
          })
          .parse(data);
        const lead = check(
          await db
            .from("leads")
            .select("*")
            .eq("id", input.lead_id)
            .eq("organization_id", s.org)
            .single(),
        );
        if (lead.do_not_contact) throw new Error("Contactarea este oprită.");
        const conv = check(
          await root
            .from("conversations")
            .upsert(
              { organization_id: s.org, lead_id: lead.id, channel: "email" },
              { onConflict: "organization_id,lead_id,channel" },
            )
            .select()
            .single(),
        );
        const assignment = check(
          await db
            .from("campaign_leads")
            .select("campaign_id")
            .eq("organization_id", s.org)
            .eq("lead_id", lead.id)
            .order("created_at", { ascending: false })
            .limit(1),
        )[0];
        let inboundQuery = db
          .from("messages")
          .select("id,subject,campaign_id,metadata")
          .eq("organization_id", s.org)
          .eq("lead_id", lead.id)
          .eq("direction", "inbound");
        if (input.inbound_id)
          inboundQuery = inboundQuery.eq("id", input.inbound_id);
        const inbound = check(
          await inboundQuery
            .order("received_at", { ascending: false })
            .limit(1),
        )[0];
        if (input.inbound_id && !inbound)
          throw new Error("Răspunsul ales nu aparține acestei conversații.");
        const previousReply = inbound
          ? check(
              await db
                .from("messages")
                .select("id,status,idempotency_key,metadata,updated_at")
                .eq("organization_id", s.org)
                .eq("in_reply_to", inbound.id)
                .maybeSingle(),
            )
          : null;
        if (
          previousReply &&
          !["draft", "approved", "queued"].includes(previousReply.status)
        )
          throw new Error(
            "Răspunsul a fost deja trimis sau este în curs. Verifică istoricul înainte de o nouă trimitere.",
          );
        const replyValues = {
          organization_id: s.org,
          lead_id: lead.id,
          conversation_id: conv.id,
          campaign_id: inbound?.campaign_id || assignment?.campaign_id,
          in_reply_to: inbound?.id,
          direction: "outbound",
          body: input.body,
          subject: inbound?.subject
            ? /^re:/i.test(inbound.subject)
              ? inbound.subject
              : `Re: ${inbound.subject}`
            : `Re: ${lead.company_name}`,
          status: "draft",
          idempotency_key:
            previousReply?.idempotency_key || crypto.randomUUID(),
          approved_by: null,
          approved_at: null,
          metadata: {
            ...metadataObject(previousReply?.metadata),
            review_state: "draft",
            human_approved: false,
          },
        };
        if (previousReply) {
          const updated = await root
            .from("messages")
            .update(replyValues)
            .eq("organization_id", s.org)
            .eq("id", previousReply.id)
            .eq("status", previousReply.status)
            .eq("updated_at", previousReply.updated_at)
            .select("id")
            .single();
          if (updated.error)
            throw new Error(
              "Răspunsul a început să fie trimis. Actualizează istoricul înainte de modificare.",
            );
          check(updated);
        } else check(await root.from("messages").insert(replyValues));
        break;
      }
      case "knowledge_save": {
        const input = z
          .object({
            id: z.uuid().optional(),
            title: z.string().min(2).max(200),
            category: z.enum(categories),
            content: z.string().min(1).max(50000),
            active: z.boolean(),
          })
          .parse(data);
        const { id, ...values } = input;
        result = id
          ? check(
              await db
                .from("knowledge_base_documents")
                .update(values)
                .eq("id", id)
                .eq("organization_id", s.org)
                .select()
                .single(),
            )
          : check(
              await db
                .from("knowledge_base_documents")
                .insert({ ...values, organization_id: s.org })
                .select()
                .single(),
            );
        break;
      }
      case "knowledge_delete": {
        const { id } = z.object({ id: z.uuid() }).parse(data);
        check(
          await db
            .from("knowledge_base_documents")
            .update({ deleted_at: new Date().toISOString(), active: false })
            .eq("id", id)
            .eq("organization_id", s.org),
        );
        break;
      }
      case "settings_save": {
        const input = z
          .object({
            provider: z.literal("google_gemini"),
            model: z.string().min(1).max(100),
            prompt: z.string().min(20).max(20000),
            input_cost_per_million: z.number().min(0).max(10000),
            output_cost_per_million: z.number().min(0).max(10000),
          })
          .parse(data);
        check(
          await db.from("settings").upsert(
            [
              {
                organization_id: s.org,
                key: "ai_provider",
                value: input.provider,
              },
              {
                organization_id: s.org,
                key: "ai_models",
                value: {
                  default: input.model,
                },
              },
              {
                organization_id: s.org,
                key: "ai_system_prompt",
                value: input.prompt,
              },
              {
                organization_id: s.org,
                key: "costs",
                value: {
                  input_per_million: input.input_cost_per_million,
                  output_per_million: input.output_cost_per_million,
                },
              },
            ],
            { onConflict: "organization_id,key" },
          ),
        );
        break;
      }
      case "whatsapp_template": {
        if (!manager) throw new Error("Este necesar rolul de administrator.");
        const input = z
          .object({
            name: z.string().min(2).max(100),
            body: z.string().min(2).max(2000),
            flow: z.enum(["user_initiated", "opt_in"]),
          })
          .parse(data);
        check(
          await db.from("settings").insert({
            organization_id: s.org,
            key: `whatsapp_template:${crypto.randomUUID()}`,
            value: { ...input, language: "ro", provider_approved: false },
          }),
        );
        break;
      }
      case "integration_toggle": {
        const input = z
          .object({
            provider: z.enum([
              "google_gemini",
              "resend",
              "elevenlabs",
              "stripe",
            ]),
            enabled: z.boolean(),
          })
          .parse(data);
        check(
          await db
            .from("integrations")
            .update({ enabled: input.enabled })
            .eq("organization_id", s.org)
            .eq("provider", input.provider),
        );
        break;
      }
      case "task_complete": {
        const { id } = z.object({ id: z.uuid() }).parse(data);
        check(
          await db
            .from("tasks")
            .update({ status: "completed" })
            .eq("id", id)
            .eq("organization_id", s.org),
        );
        break;
      }
      case "retry_job": {
        const { id } = z.object({ id: z.uuid() }).parse(data);
        const job = check(
          await db
            .from("automation_jobs")
            .select("*")
            .eq("id", id)
            .eq("organization_id", s.org)
            .single(),
        );
        if (!["failed", "completed"].includes(job.status))
          throw new Error("Automatizarea este deja în lucru.");
        check(
          await root
            .from("automation_jobs")
            .update({
              status: "pending",
              attempts: 0,
              next_action_at: new Date().toISOString(),
              last_error: null,
              completed_at: null,
            })
            .eq("id", job.id)
            .eq("organization_id", s.org),
        );
        break;
      }
      case "checkout": {
        const { id } = z.object({ id: z.uuid() }).parse(data);
        const lead = check(
          await db
            .from("leads")
            .select("*")
            .eq("id", id)
            .eq("organization_id", s.org)
            .single(),
        );
        if (lead.do_not_contact) throw new Error("Contactarea este oprită.");
        const url = await new StripeProvider().checkout({
          org: s.org,
          lead: lead.id,
          email: lead.email,
          origin: appUrl(),
        });
        const assignment = check(
          await db
            .from("campaign_leads")
            .select("campaign_id")
            .eq("organization_id", s.org)
            .eq("lead_id", lead.id)
            .order("created_at", { ascending: false })
            .limit(1),
        )[0];
        check(
          await root.from("messages").upsert(
            {
              organization_id: s.org,
              lead_id: lead.id,
              campaign_id: assignment?.campaign_id,
              direction: "outbound",
              body: `Bună ziua!\nLinkul de plată VoxaTech: ${url}\nDupă confirmarea plății veți primi formularul de configurare.`,
              subject: "VoxaTech · link de plată",
              status: "draft",
              idempotency_key: `checkout-draft:${lead.id}:${Math.floor(Date.now() / 3600000)}`,
              metadata: { checkout: true },
            },
            {
              onConflict: "organization_id,idempotency_key",
              ignoreDuplicates: true,
            },
          ),
        );
        result = { url };
        break;
      }
      case "password": {
        const { password } = z
          .object({ password: z.string().min(12).max(128) })
          .parse(data);
        const { error } = await db.auth.updateUser({ password });
        if (error) throw new Error("Parola nu a putut fi actualizată.");
        break;
      }
      case "logout":
        await db.auth.signOut();
        break;
      default:
        return NextResponse.json(
          { error: "Acțiune necunoscută." },
          { status: 400 },
        );
    }
    return NextResponse.json(result, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof z.ZodError
            ? "Date invalide. Verifică toate câmpurile."
            : error instanceof Error
              ? safeError(error)
              : "Acțiunea nu a putut fi finalizată.",
      },
      { status: 400 },
    );
  }
}
