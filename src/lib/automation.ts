import "server-only";
import { z } from "zod";
class DeferredSend extends Error {}
import { admin, check, enqueue, log, appUrl, safeError, type Job } from "./db";
import { getAIProvider, safetyPrompt, type AIProviderId } from "./providers/ai";
import { sendOrganizationEmail } from "./providers/email";
import { GmailDeferredError, GmailStoppedError } from "./gmail-api";
import { syncGmail } from "./gmail-sync";
import { readPublicWebsite } from "./website";
import { aiThinkingLevel, bucharest, humanRequired, type Row } from "./domain";
import {
  outreachCopyVersion,
  verifiedOutreachFact,
  outreachInstructions,
  validateOutreach,
} from "./outreach-template";
import { optOutLine } from "./launch";
import type { Json } from "./supabase/database.types";
const evidence = z.object({
  value: z.string().nullable(),
  quote: z.string().nullable(),
});
const researchSchema = z.object({
  niche: evidence,
  city: evidence,
  services: z.array(evidence),
  hours: evidence,
  phone_booking: evidence,
  online_booking: evidence,
  multiple_doctors: evidence,
  limited_hours: evidence,
  no_visible_automation: evidence,
  personalization: evidence,
});
const draftSchema = z.object({
  subject: z.string(),
  body: z.string(),
  fact_used: z.string().nullable(),
  knowledge_ids: z.array(z.string()),
});
const draftPairSchema = z.object({
  variant_a: draftSchema,
  variant_b: draftSchema,
});

function validateReviewDraft(
  draft: z.infer<typeof draftSchema>,
  lead: Row<"leads">,
) {
  validateOutreach(draft.body, lead.company_name);
  if (!draft.body.includes(optOutLine))
    throw new Error("Linia opt-out lipsește.");
  if (
    draft.fact_used !== null &&
    draft.fact_used !== verifiedOutreachFact(lead)
  )
    throw new Error("Fapt neverificat în ciornă.");
  if (
    draft.subject !== `30 de zile gratuite cu Voxa pentru ${lead.company_name}`
  )
    throw new Error("Subiectul aprobat lipsește.");
}
const replyClassificationSchema = z.object({
  classification: z.enum([
    "positive",
    "question",
    "objection",
    "refusal",
    "unsubscribe",
    "not_interested",
    "wrong_contact",
    "human_required",
  ]),
  confidence: z.number().min(0).max(1),
  requires_human: z.boolean(),
  summary: z.string(),
  is_hot_lead: z.boolean(),
  hot_reason: z.string().nullable(),
});
const replyDraftSchema = z.object({
  subject: z.string(),
  body: z.string(),
  knowledge_ids: z.array(z.string()),
});
const payloadSchema = z.object({
  message_id: z.uuid().optional(),
  campaign_id: z.uuid().optional(),
  step: z.number().int().min(0).max(2).optional(),
  send: z.boolean().optional(),
  event_id: z.uuid().optional(),
  variant: z.enum(["A", "B"]).optional(),
});
async function config(org: string) {
  const rows = check(
    await admin().from("settings").select("*").eq("organization_id", org),
  );
  return Object.fromEntries(rows.map((r) => [r.key, r.value]));
}
async function generation<T>(
  org: string,
  lead: Row<"leads">,
  name: string,
  schema: z.ZodType<T>,
  prompt: string,
  includePayload = false,
) {
  const cfg = await config(org);
  const providerId = z
    .enum(["google_gemini"])
    .parse(
      cfg.ai_provider || process.env.AI_PROVIDER || "google_gemini",
    ) as AIProviderId;
  const models = z.object({ default: z.string() }).safeParse(cfg.ai_models);
  const model =
    models.data?.default ||
    process.env.DEFAULT_AUTOMATION_MODEL ||
    "gemini-3.8-flash";
  const costs = z
    .object({
      input_per_million: z.number().nonnegative(),
      output_per_million: z.number().nonnegative(),
    })
    .safeParse(cfg.costs);
  const provider = getAIProvider(providerId);
  const thinkingLevel = aiThinkingLevel(name);
  const system = `${safetyPrompt}\n${typeof cfg.ai_system_prompt === "string" ? cfg.ai_system_prompt : ""}\nRegulile de siguranță de mai sus au prioritate.`;
  const result = await provider
    .generate({
      model,
      name,
      schema,
      system,
      prompt,
      thinkingLevel,
      pricing: {
        inputPerMillion:
          costs.data?.input_per_million ??
          Number(process.env.GEMINI_INPUT_COST_PER_MILLION || 0.75),
        outputPerMillion:
          costs.data?.output_per_million ??
          Number(process.env.GEMINI_OUTPUT_COST_PER_MILLION || 3.75),
      },
    })
    .catch(async (error) => {
      check(
        await admin()
          .from("integrations")
          .upsert(
            {
              organization_id: org,
              provider: "google_gemini",
              enabled: !!process.env.GEMINI_API_KEY,
              public_config: { health: "error", model },
            },
            { onConflict: "organization_id,provider" },
          ),
      );
      throw error;
    });
  const details = {
    provider: result.provider,
    model: result.model,
    thinking_level: result.thinkingLevel,
    latency_ms: result.latencyMs,
    tokens: result.usage.total_tokens,
    usage: result.usage,
    estimated_cost_usd: result.estimatedCostUsd,
    ...(includePayload
      ? {
          input: { instructions: system, prompt },
          output: result.value,
        }
      : {}),
  } as Json;
  await log(org, `ai_${name}`, lead.id, details, result.model);
  check(
    await admin()
      .from("integrations")
      .upsert(
        {
          organization_id: org,
          provider: "google_gemini",
          enabled: true,
          last_verified_at: new Date().toISOString(),
          public_config: {
            health: "healthy",
            model: result.model,
            provider: result.provider,
          },
        },
        { onConflict: "organization_id,provider" },
      ),
  );
  return result;
}
async function knowledge(org: string) {
  return check(
    await admin()
      .from("knowledge_base_documents")
      .select("id,title,content")
      .eq("organization_id", org)
      .eq("active", true)
      .is("deleted_at", null),
  ).slice(0, 30);
}
async function conversation(org: string, lead: string) {
  return check(
    await admin()
      .from("conversations")
      .upsert(
        { organization_id: org, lead_id: lead, channel: "email" },
        { onConflict: "organization_id,lead_id,channel" },
      )
      .select()
      .single(),
  );
}
async function campaignFor(org: string, lead: string, id?: string) {
  if (id)
    return check(
      await admin()
        .from("campaigns")
        .select("*")
        .eq("organization_id", org)
        .eq("id", id)
        .single(),
    );
  const row = check(
    await admin()
      .from("campaign_leads")
      .select("campaign_id")
      .eq("organization_id", org)
      .eq("lead_id", lead)
      .order("created_at", { ascending: false })
      .limit(1),
  );
  return row[0]
    ? check(
        await admin()
          .from("campaigns")
          .select("*")
          .eq("organization_id", org)
          .eq("id", row[0].campaign_id)
          .single(),
      )
    : null;
}
async function attention(org: string, lead: Row<"leads">, reason: string) {
  if (!lead.do_not_contact)
    check(
      await admin()
        .from("leads")
        .update({ status: "HUMAN_REQUIRED" })
        .eq("id", lead.id)
        .eq("organization_id", org),
    );
  const existing = check(
    await admin()
      .from("tasks")
      .select("id")
      .eq("organization_id", org)
      .eq("lead_id", lead.id)
      .eq("title", "Intervenție umană necesară")
      .in("status", ["open", "in_progress"]),
  );
  if (!existing.length) {
    const result = await admin().from("tasks").insert({
      organization_id: org,
      lead_id: lead.id,
      title: "Intervenție umană necesară",
      description: reason,
    });
    if (result.error?.code !== "23505") check(result);
  }
  await enqueue(org, "notify_human_required", `attention:${lead.id}`, lead.id);
}
async function enrichFromText(
  job: Pick<Job, "organization_id">,
  lead: Row<"leads">,
  text: string,
  includePayload = false,
) {
  const generated = await generation(
    job.organization_id,
    lead,
    "research",
    researchSchema,
    `Extrage numai fapte explicite din pagina următoare. Fiecare fapt are un citat exact din sursă; fără dovadă, value și quote sunt null. Pentru câmpuri booleene folosește da/nu numai când textul susține explicit. Absența unei mențiuni nu dovedește absența funcției.\n${text}`,
    includePayload,
  );
  const { value } = generated;
  const verified = (fact: z.infer<typeof evidence>) =>
    fact.value &&
    fact.quote &&
    text.toLowerCase().includes(fact.quote.toLowerCase())
      ? fact.value
      : null;
  const facts = Object.fromEntries(
    Object.entries(value)
      .filter(([k]) => k !== "services")
      .map(([k, v]) => [k, verified(v as z.infer<typeof evidence>)]),
  );
  const services = value.services.map(verified).filter((v): v is string => !!v);
  const reasons: { reason: string; points: number }[] = [];
  for (const [key, label, points] of [
    ["phone_booking", "Programări telefonice", 20],
    ["multiple_doctors", "Mai mulți medici", 15],
    ["limited_hours", "Program limitat", 10],
    ["no_visible_automation", "Lipsa automatizării confirmată", 15],
  ] as const)
    if (facts[key]?.toLowerCase() === "da")
      reasons.push({ reason: label, points });
  if (facts.online_booking?.toLowerCase() === "nu")
    reasons.push({
      reason: "Fără programare online, conform site-ului",
      points: 10,
    });
  if (
    /stomat|dentar|dermato|estetic|orl|oftalmo|medical/i.test(facts.niche || "")
  )
    reasons.push({ reason: "Specialitate potrivită", points: 10 });
  const score = Math.min(
    90,
    reasons.reduce((n, r) => n + r.points, 0),
  );
  const summaryHours = (facts.hours || "necunoscut").replace(/[.\s]+$/, "");
  check(
    await admin()
      .from("leads")
      .update({
        status: "READY_FOR_OUTREACH",
        niche: facts.niche || lead.niche,
        city: facts.city || lead.city,
        services,
        opening_hours: facts.hours ? { text: facts.hours } : null,
        personalization_fact: facts.personalization,
        website_summary: `${lead.company_name}: ${facts.niche || "specialitate necunoscută"}. Servicii: ${services.join(", ") || "necunoscute"}. Program: ${summaryHours}.`,
        verified_facts: facts,
        lead_score: score,
        lead_temperature: score >= 80 ? "hot" : score >= 45 ? "warm" : "cold",
        score_reasons: reasons,
        enriched_at: new Date().toISOString(),
      })
      .eq("id", lead.id),
  );
  return generated;
}
async function enrich(job: Job, lead: Row<"leads">) {
  if (lead.do_not_contact) return;
  check(
    await admin()
      .from("leads")
      .update({ status: "ENRICHING" })
      .eq("id", lead.id),
  );
  if (!lead.website) {
    check(
      await admin()
        .from("leads")
        .update({
          status: "READY_FOR_OUTREACH",
          website_summary:
            "Site necunoscut. Nu există informații publice verificate.",
          lead_score: 0,
          score_reasons: [],
          enriched_at: new Date().toISOString(),
        })
        .eq("id", lead.id),
    );
    return;
  }
  await enrichFromText(job, lead, await readPublicWebsite(lead.website));
}
async function draft(job: Job, lead: Row<"leads">, includePayload = false) {
  if (lead.do_not_contact) return;
  const p = payloadSchema.parse(job.payload);
  const campaign = await campaignFor(
    job.organization_id,
    lead.id,
    p.campaign_id,
  );
  const step = p.step || 0;
  const variant = p.variant;
  if (
    step > 0 &&
    check(
      await admin()
        .from("messages")
        .select("id")
        .eq("lead_id", lead.id)
        .eq("direction", "inbound")
        .limit(1),
    ).length
  )
    return;
  const docs = await knowledge(job.organization_id);
  const conv = await conversation(job.organization_id, lead.id);
  const generated = await generation(
    job.organization_id,
    lead,
    "outreach",
    draftSchema,
    JSON.stringify({
      task: outreachInstructions(lead.company_name, optOutLine),
      variant: variant || "standard",
      verified_summary: lead.website_summary,
      verified_relevant_fact: verifiedOutreachFact(lead),
      fact_used_rule:
        "Întoarce fact_used=null dacă nu folosești verified_relevant_fact. Dacă îl folosești, fact_used trebuie să fie identic cu verified_relevant_fact.",
      company: lead.company_name,
      step,
      campaign,
      knowledge: docs,
    }),
    includePayload,
  );
  const { value, model } = generated;
  validateReviewDraft(value, lead);
  const key = `outreach:${lead.id}:${campaign?.id || "manual"}:${step}${variant ? `:${variant}` : ""}`;
  const existingVariant = variant
    ? check(
        await admin()
          .from("messages")
          .select("metadata,subject")
          .eq("organization_id", job.organization_id)
          .eq("idempotency_key", key)
          .maybeSingle(),
      )
    : null;
  const existingMetadata =
    existingVariant?.metadata &&
    typeof existingVariant.metadata === "object" &&
    !Array.isArray(existingVariant.metadata)
      ? existingVariant.metadata
      : {};
  check(
    await admin()
      .from("messages")
      .upsert(
        {
          organization_id: job.organization_id,
          lead_id: lead.id,
          conversation_id: conv.id,
          campaign_id: campaign?.id,
          direction: "outbound",
          subject: value.subject,
          body: value.body,
          model,
          knowledge_document_ids: value.knowledge_ids.filter((id) =>
            docs.some((d) => d.id === id),
          ),
          idempotency_key: key,
          follow_up_number: variant ? null : step,
          status: campaign?.mode === "automatic" ? "queued" : "draft",
          approved_by: variant ? null : undefined,
          approved_at: variant ? null : undefined,
          metadata: {
            ...existingMetadata,
            ...(variant ? { outreach_variant: variant } : {}),
            provider: generated.provider,
            thinking_level: generated.thinkingLevel,
            token_usage: generated.usage,
            estimated_cost_usd: generated.estimatedCostUsd,
            dry_run_review: !!variant,
            copy_version: outreachCopyVersion,
            reply_to: "contact@voxatech.ro",
            primary_style: variant === "B",
            fact_used: value.fact_used,
            review_state: variant ? "draft" : undefined,
            last_test_sent_at: variant ? null : undefined,
            last_test_provider_id: variant ? null : undefined,
          },
        },
        {
          onConflict: "organization_id,idempotency_key",
          ignoreDuplicates: !variant,
        },
      ),
  );
  return generated;
}
async function draftPair(job: Job, lead: Row<"leads">, includePayload = false) {
  if (lead.do_not_contact) return;
  const p = payloadSchema.parse(job.payload);
  const campaign = await campaignFor(
    job.organization_id,
    lead.id,
    p.campaign_id,
  );
  const docs = await knowledge(job.organization_id);
  const conv = await conversation(job.organization_id, lead.id);
  const request = {
    task:
      outreachInstructions(lead.company_name, optOutLine) +
      " Generează variant_a și variant_b cu același șablon și mici diferențe de exprimare.",
    verified_summary: lead.website_summary,
    verified_relevant_fact: verifiedOutreachFact(lead),
    fact_used_rule:
      "Pentru fiecare variantă, fact_used este null dacă nu folosești verified_relevant_fact. Dacă îl folosești, valoarea trebuie să fie identică cu verified_relevant_fact. În corpul emailului parafrazează faptul natural și nu folosi expresia «programul public verificat».",
    company: lead.company_name,
    contact_name: lead.contact_name,
    campaign,
    knowledge: docs,
  };
  let generated = await generation(
    job.organization_id,
    lead,
    "outreach",
    draftPairSchema,
    JSON.stringify(request),
    includePayload,
  );
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      validateReviewDraft(generated.value.variant_a, lead);
      validateReviewDraft(generated.value.variant_b, lead);
      break;
    } catch (error) {
      if (attempt === 2) throw error;
      generated = await generation(
        job.organization_id,
        lead,
        "outreach",
        draftPairSchema,
        JSON.stringify({
          ...request,
          correction:
            error instanceof Error
              ? `Rezultatul anterior a fost respins: ${error.message} Rescrie ambele variante și respectă toate regulile.`
              : "Rescrie ambele variante și respectă toate regulile.",
        }),
        includePayload,
      );
    }
  }
  const halves = (value: number) => [
    Math.floor(value / 2),
    Math.ceil(value / 2),
  ];
  const [inputA, inputB] = halves(generated.usage.input_tokens);
  const [outputA, outputB] = halves(generated.usage.output_tokens);
  const [thinkingA, thinkingB] = halves(generated.usage.thinking_tokens);
  const [cachedA, cachedB] = halves(generated.usage.cached_tokens);
  const [totalA, totalB] = halves(generated.usage.total_tokens);
  for (const [index, [variant, value]] of (
    [
      ["A", generated.value.variant_a],
      ["B", generated.value.variant_b],
    ] as const
  ).entries()) {
    const usage = {
      input_tokens: index === 0 ? inputA : inputB,
      output_tokens: index === 0 ? outputA : outputB,
      thinking_tokens: index === 0 ? thinkingA : thinkingB,
      cached_tokens: index === 0 ? cachedA : cachedB,
      total_tokens: index === 0 ? totalA : totalB,
    };
    check(
      await admin()
        .from("messages")
        .upsert(
          {
            organization_id: job.organization_id,
            lead_id: lead.id,
            conversation_id: conv.id,
            campaign_id: campaign?.id,
            direction: "outbound",
            subject: value.subject,
            body: value.body,
            model: generated.model,
            knowledge_document_ids: value.knowledge_ids.filter((id) =>
              docs.some((doc) => doc.id === id),
            ),
            idempotency_key: `outreach:${lead.id}:${campaign?.id || "manual"}:0:${variant}`,
            follow_up_number: null,
            status: "draft",
            metadata: {
              outreach_variant: variant,
              provider: generated.provider,
              thinking_level: generated.thinkingLevel,
              token_usage: usage,
              estimated_cost_usd: generated.estimatedCostUsd / 2,
              dry_run_review: true,
              copy_version: outreachCopyVersion,
              primary_style: variant === "B",
              fact_used: value.fact_used,
            },
          },
          {
            onConflict: "organization_id,idempotency_key",
          },
        ),
    );
  }
  return generated;
}
async function incoming(job: Job, lead: Row<"leads">) {
  const p = payloadSchema.parse(job.payload);
  if (!p.message_id) throw new Error("Mesaj lipsă.");
  const inbound = check(
    await admin()
      .from("messages")
      .select("*")
      .eq("id", p.message_id)
      .eq("organization_id", job.organization_id)
      .single(),
  );
  if (lead.do_not_contact) return;
  if (humanRequired(inbound.body)) {
    await attention(
      job.organization_id,
      lead,
      "Solicitare despre contracte, conformitate, reduceri sau integrare.",
    );
    check(
      await admin()
        .from("messages")
        .update({ classification: "human_required" })
        .eq("id", inbound.id),
    );
    return;
  }
  if (
    /(dezabon|unsubscribe|nu mă mai contact|nu ma mai contact|nu (suntem|sunt) interesa|nu doresc|stop)/i.test(
      inbound.body,
    )
  ) {
    check(
      await admin().rpc("suppress_lead", {
        org: job.organization_id,
        target: lead.id,
        reason_text: "Refuz sau dezabonare",
      }),
    );
    check(
      await admin()
        .from("messages")
        .update({ classification: "refusal" })
        .eq("id", inbound.id),
    );
    return;
  }
  const docs = await knowledge(job.organization_id);
  const classification = await generation(
    job.organization_id,
    lead,
    "classification",
    replyClassificationSchema,
    JSON.stringify({
      task: "Clasifică mesajul și rezumă-l pentru CRM. is_hot_lead=true numai dacă există interes comercial explicit pentru Voxa: cere demo, test, ofertă/preț pentru implementare sau o discuție concretă. Un răspuns politicos, întrebare generică, mesaj automat, refuz ori dezabonare nu este hot. hot_reason explică scurt dovada sau este null. Pentru contracte, GDPR, reduceri, integrări personalizate ori întrebări tehnice complexe setează requires_human. Nu redacta încă un răspuns.",
      message: inbound.body,
      lead_summary: lead.website_summary,
    }),
  );
  check(
    await admin()
      .from("messages")
      .update({
        classification: classification.value.classification,
        model: classification.model,
        metadata: {
          ...(inbound.metadata &&
          typeof inbound.metadata === "object" &&
          !Array.isArray(inbound.metadata)
            ? inbound.metadata
            : {}),
          is_hot_lead:
            classification.value.is_hot_lead &&
            classification.value.confidence >= 0.85 &&
            ![
              "refusal",
              "unsubscribe",
              "not_interested",
              "wrong_contact",
            ].includes(classification.value.classification),
          classification_confidence: classification.value.confidence,
          hot_reason: classification.value.hot_reason,
        },
      })
      .eq("id", inbound.id),
  );
  check(
    await admin()
      .from("leads")
      .update({ conversation_summary: classification.value.summary })
      .eq("id", lead.id),
  );
  if (
    ["refusal", "unsubscribe", "not_interested", "wrong_contact"].includes(
      classification.value.classification,
    )
  ) {
    check(
      await admin().rpc("suppress_lead", {
        org: job.organization_id,
        target: lead.id,
        reason_text: classification.value.classification,
      }),
    );
    return;
  }
  if (
    classification.value.requires_human ||
    classification.value.confidence < 0.85 ||
    classification.value.classification === "human_required"
  ) {
    await attention(job.organization_id, lead, classification.value.summary);
    return;
  }
  const response = await generation(
    job.organization_id,
    lead,
    classification.value.classification === "objection"
      ? "objection_reply"
      : "inbound_reply",
    replyDraftSchema,
    JSON.stringify({
      task: "Răspunde scurt și natural în română folosind numai documentele furnizate. Pentru interes pozitiv oferă un demo personalizat sau test. Nu inventa și nu negocia. Dacă documentele nu susțin un răspuns sigur, lasă body gol.",
      classification: classification.value,
      message: inbound.body,
      lead_summary: lead.website_summary,
      knowledge: docs,
    }),
  );
  const citations = response.value.knowledge_ids.filter((id) =>
    docs.some((d) => d.id === id),
  );
  if (!response.value.body || !citations.length) {
    await attention(job.organization_id, lead, classification.value.summary);
    return;
  }
  const campaign = await campaignFor(job.organization_id, lead.id);
  check(
    await admin()
      .from("messages")
      .upsert(
        {
          organization_id: job.organization_id,
          lead_id: lead.id,
          conversation_id: inbound.conversation_id,
          campaign_id: campaign?.id,
          in_reply_to: inbound.id,
          direction: "outbound",
          subject: response.value.subject,
          body: response.value.body,
          idempotency_key: `reply:${inbound.id}`,
          knowledge_document_ids: citations,
          model: response.model,
          status: campaign?.mode === "automatic" ? "queued" : "draft",
        },
        {
          onConflict: "organization_id,idempotency_key",
          ignoreDuplicates: true,
        },
      ),
  );
  check(
    await admin()
      .from("leads")
      .update({
        status:
          classification.value.classification === "positive"
            ? "QUALIFIED"
            : "REPLIED",
      })
      .eq("id", lead.id),
  );
  // Interested prospects remain in Inbox for a human conversation.
}
function messageMetadata(message: Row<"messages">) {
  return message.metadata &&
    typeof message.metadata === "object" &&
    !Array.isArray(message.metadata)
    ? message.metadata
    : {};
}
async function recordDelivery(
  job: Job,
  message: Row<"messages">,
  simulated: boolean,
) {
  const metadata = messageMetadata(message);
  const status = metadata.transactional_onboarding
    ? "WON"
    : metadata.demo_id
      ? "DEMO_SENT"
      : message.follow_up_number === 1
        ? "FOLLOW_UP_1"
        : message.follow_up_number === 2
          ? "FOLLOW_UP_2"
          : message.in_reply_to
            ? "REPLIED"
            : metadata.checkout
              ? "CHECKOUT_SENT"
              : "CONTACTED";
  check(
    await admin()
      .from("leads")
      .update({
        status,
        last_contact_at: new Date().toISOString(),
        next_action_at:
          status === "WON"
            ? null
            : new Date(Date.now() + 3 * 86400000).toISOString(),
      })
      .eq("id", message.lead_id)
      .eq("organization_id", job.organization_id)
      .eq("do_not_contact", false),
  );
  await log(
    job.organization_id,
    simulated ? "email_simulated" : "email_sent",
    message.lead_id,
    { message_id: message.id, delivery: simulated ? "log" : "live" },
  );
}
async function send(job: Job) {
  const p = payloadSchema.parse(job.payload);
  if (!p.message_id) throw new Error("Mesaj lipsă.");
  if (process.env.EMAIL_DELIVERY_MODE !== "live") {
    const simulated = check(
      await admin().rpc("simulate_outbound_message", {
        message_id: p.message_id,
      }),
    )[0];
    if (!simulated) {
      const current = check(
        await admin()
          .from("messages")
          .select("*")
          .eq("id", p.message_id)
          .eq("organization_id", job.organization_id)
          .single(),
      );
      if (
        [
          "sent",
          "delivered",
          "opened",
          "cancelled",
          "bounced",
          "failed",
        ].includes(current.status)
      )
        return;
      throw new DeferredSend(
        "Campania sau aprobarea nu permite simularea încă.",
      );
    }
    await recordDelivery(job, simulated, true);
    return;
  }
  const resendFrom = process.env.RESEND_FROM_EMAIL || process.env.EMAIL_FROM;
  const reserved = check(
    await admin().rpc("reserve_outbound_message", { message_id: p.message_id }),
  );
  const m = reserved[0];
  if (!m) {
    const current = check(
      await admin()
        .from("messages")
        .select("*")
        .eq("id", p.message_id)
        .single(),
    );
    if (
      [
        "sent",
        "delivered",
        "opened",
        "cancelled",
        "bounced",
        "failed",
      ].includes(current.status)
    )
      return;
    const target = check(
      await admin()
        .from("leads")
        .select("*")
        .eq("id", current.lead_id)
        .eq("organization_id", job.organization_id)
        .single(),
    );
    const metadata = messageMetadata(current);
    if (
      !target.email ||
      target.do_not_contact ||
      ["DO_NOT_CONTACT", "LOST"].includes(target.status) ||
      (target.status === "WON" && !metadata.transactional_onboarding) ||
      (target.status === "HUMAN_REQUIRED" && !metadata.human_approved)
    ) {
      check(
        await admin()
          .from("messages")
          .update({ status: target.do_not_contact ? "cancelled" : "failed" })
          .eq("id", current.id)
          .eq("organization_id", job.organization_id),
      );
      if (!target.do_not_contact)
        await attention(
          job.organization_id,
          target,
          !target.email
            ? "Mesajul nu poate fi livrat: prospectul nu are adresă de email."
            : "Mesajul a fost oprit de starea curentă a prospectului.",
        );
      return;
    }
    if (
      current.status === "sending" &&
      current.reserved_at &&
      Date.now() - new Date(current.reserved_at).getTime() > 23 * 3600000
    ) {
      await attention(
        job.organization_id,
        target,
        "Livrare incertă. Verifică furnizorul înainte de o nouă trimitere.",
      );
      throw new Error("Livrare incertă; nu se retrimite automat.");
    }
    throw new DeferredSend(
      "În afara intervalului sau campanie/aprobare indisponibilă.",
    );
  }
  const lead = check(
    await admin()
      .from("leads")
      .select("*")
      .eq("id", m.lead_id)
      .eq("organization_id", job.organization_id)
      .single(),
  );
  if (lead.do_not_contact || !lead.email) {
    check(
      await admin()
        .from("messages")
        .update({ status: lead.do_not_contact ? "cancelled" : "failed" })
        .eq("id", m.id),
    );
    return;
  }
  const blocked = check(
    await admin()
      .from("suppression_list")
      .select("id")
      .eq("organization_id", job.organization_id)
      .eq("identifier", lead.email.toLowerCase())
      .limit(1),
  );
  if (blocked.length) {
    check(
      await admin()
        .from("messages")
        .update({ status: "cancelled" })
        .eq("id", m.id),
    );
    return;
  }
  const transactional = !!messageMetadata(m).transactional_onboarding;
  const campaign = m.campaign_id
    ? check(
        await admin()
          .from("campaigns")
          .select("sender_identity,status")
          .eq("id", m.campaign_id)
          .eq("organization_id", job.organization_id)
          .single(),
      )
    : null;
  if (!transactional && campaign?.status !== "active")
    throw new DeferredSend("Campania nu este activă.");
  const from = campaign?.sender_identity || resendFrom;
  if (!from) throw new Error("Selectează un expeditor conectat.");
  const replyParent = m.in_reply_to
    ? check(
        await admin()
          .from("messages")
          .select("metadata,subject")
          .eq("organization_id", job.organization_id)
          .eq("id", m.in_reply_to)
          .single(),
      )
    : null;
  const replyMetadata =
    replyParent?.metadata &&
    typeof replyParent.metadata === "object" &&
    !Array.isArray(replyParent.metadata)
      ? replyParent.metadata
      : {};
  let result: Awaited<ReturnType<typeof sendOrganizationEmail>>;
  const deliverySubject =
    typeof replyMetadata.gmail_thread_id === "string" && replyParent?.subject
      ? /^re:/i.test(replyParent.subject)
        ? replyParent.subject
        : `Re: ${replyParent.subject}`
      : m.subject || "Voxa";
  try {
    result = await sendOrganizationEmail(job.organization_id, {
      from:
        typeof replyMetadata.mailbox_email === "string"
          ? replyMetadata.mailbox_email
          : from,
      to: lead.email,
      subject: deliverySubject,
      text: m.body,
      key: m.id,
      unsubscribe: `${appUrl()}/unsubscribe/${m.unsubscribe_token}`,
      replyTo: process.env.RESEND_INBOUND_DOMAIN
        ? `reply+${m.reply_token}@${process.env.RESEND_INBOUND_DOMAIN}`
        : undefined,
      parentId: m.id,
      leadId: m.lead_id,
      threadId:
        typeof replyMetadata.gmail_thread_id === "string"
          ? replyMetadata.gmail_thread_id
          : undefined,
      inReplyTo:
        typeof replyMetadata.rfc_message_id === "string" &&
        /^<[^<>\s]+@[^<>\s]+>$/.test(replyMetadata.rfc_message_id)
          ? replyMetadata.rfc_message_id
          : undefined,
    });
  } catch (error) {
    if (error instanceof GmailStoppedError) {
      check(
        await admin()
          .from("messages")
          .update({ status: "cancelled", reserved_at: null })
          .eq("organization_id", job.organization_id)
          .eq("id", m.id)
          .eq("status", "sending"),
      );
      await log(job.organization_id, "email_stopped_before_gmail", m.lead_id, {
        message_id: m.id,
        reason: error.message,
      });
      return;
    }
    if (error instanceof GmailDeferredError) {
      check(
        await admin()
          .from("messages")
          .update({
            status: m.approved_by ? "approved" : "queued",
            reserved_at: null,
          })
          .eq("organization_id", job.organization_id)
          .eq("id", m.id)
          .eq("status", "sending"),
      );
      throw new DeferredSend(error.message);
    }
    throw error;
  }
  if (result.mode === "log") return;
  check(
    await admin()
      .from("messages")
      .update({
        status: "sent",
        subject: deliverySubject,
        sent_at: new Date().toISOString(),
        provider: result.provider,
        provider_message_id: result.id,
        metadata: {
          ...messageMetadata(m),
          ...(result.provider === "gmail"
            ? { mailbox_email: result.senderEmail }
            : {}),
        },
      })
      .eq("id", m.id),
  );
  await recordDelivery(job, m, false);
}
async function summary(org: string) {
  const today = bucharest().date;
  const stats = z
    .record(z.string(), z.number())
    .parse(check(await admin().rpc("daily_metrics", { org, day: today })));
  const body = `Prospecte noi: ${stats.new_leads}; contactate azi: ${stats.contacted}; răspunsuri azi: ${stats.replies}; calificate azi: ${stats.qualified}; demo trimise azi: ${stats.demos_sent}; prospecte fierbinți care necesită atenție: ${stats.hot_attention}; automatizări cu erori: ${stats.failures}.`;
  check(
    await admin()
      .from("notifications")
      .upsert(
        {
          organization_id: org,
          title: `Rezumat zilnic · ${today}`,
          body,
          idempotency_key: `summary:${today}`,
        },
        {
          onConflict: "organization_id,idempotency_key",
          ignoreDuplicates: true,
        },
      ),
  );
}
export async function runJob(job: Job) {
  let lead = job.lead_id
    ? check(
        await admin()
          .from("leads")
          .select("*")
          .eq("id", job.lead_id)
          .eq("organization_id", job.organization_id)
          .single(),
      )
    : null;
  switch (job.kind) {
    case "enrich_new_leads":
      if (lead) await enrich(job, lead);
      break;
    case "create_outreach_drafts":
      // Imported campaigns must research a new lead before composing its email.
      // The scheduler reserves only the daily batch, so this does not research
      // thousands of unused prospects upfront.
      if (lead && !lead.enriched_at && !lead.do_not_contact) {
        await enrich(job, lead);
        lead = check(
          await admin()
            .from("leads")
            .select("*")
            .eq("organization_id", job.organization_id)
            .eq("id", lead.id)
            .single(),
        );
      }
      if (lead) await draft(job, lead);
      break;
    case "process_inbound_replies":
      if (lead) await incoming(job, lead);
      break;
    case "generate_requested_demos":
      // Voice demos were retired; historical jobs complete without provider calls.
      break;
    case "send_due_messages":
      await send(job);
      break;
    case "process_follow_ups":
      if (lead && !lead.do_not_contact) {
        const p = payloadSchema.parse(job.payload);
        if ((p.step || 0) <= 2)
          await draft({ ...job, payload: p as Json }, lead);
      }
      break;
    case "notify_human_required":
      check(
        await admin()
          .from("notifications")
          .upsert(
            {
              organization_id: job.organization_id,
              title: "Intervenție umană necesară",
              body: lead?.company_name || "Verifică lista de intervenții.",
              idempotency_key: job.idempotency_key,
            },
            {
              onConflict: "organization_id,idempotency_key",
              ignoreDuplicates: true,
            },
          ),
      );
      break;
    case "daily_summary":
      await summary(job.organization_id);
      break;
    case "sync_payment_events": {
      const p = payloadSchema.parse(job.payload);
      if (!p.event_id) throw new Error("Eveniment lipsă.");
      const event = check(
        await admin()
          .from("webhook_events")
          .select("*")
          .eq("id", p.event_id)
          .eq("organization_id", job.organization_id)
          .single(),
      );
      const data = z
        .object({
          id: z.string(),
          amount_total: z.number(),
          currency: z.string(),
          metadata: z.object({ lead_id: z.uuid(), organization_id: z.uuid() }),
        })
        .parse(event.payload);
      check(
        await admin().rpc("apply_payment", {
          org: job.organization_id,
          target: data.metadata.lead_id,
          reference: data.id,
          amount: data.amount_total / 100,
          currency_code: data.currency.toUpperCase(),
        }),
      );
      const onboarding = check(
        await admin()
          .from("onboarding_records")
          .select("*")
          .eq("organization_id", job.organization_id)
          .eq("lead_id", data.metadata.lead_id)
          .single(),
      );
      const campaign = await campaignFor(
        job.organization_id,
        data.metadata.lead_id,
      );
      if (!lead?.do_not_contact)
        check(
          await admin()
            .from("messages")
            .upsert(
              {
                organization_id: job.organization_id,
                lead_id: data.metadata.lead_id,
                campaign_id: campaign?.id,
                direction: "outbound",
                subject: "Voxa · configurarea clinicii",
                body: `Bună ziua! Vă mulțumim pentru încredere. Pentru a începe configurarea, completați formularul: ${appUrl()}/onboarding/${onboarding.share_token}`,
                status: "queued",
                idempotency_key: `onboarding:${data.id}`,
                metadata: { transactional_onboarding: true },
              },
              {
                onConflict: "organization_id,idempotency_key",
                ignoreDuplicates: true,
              },
            ),
        );
      check(
        await admin()
          .from("webhook_events")
          .update({ processed_at: new Date().toISOString() })
          .eq("id", event.id),
      );
      break;
    }
    default:
      throw new Error("Tip de automatizare necunoscut.");
  }
}

function evaluationFit(
  score: number,
  reasons: { reason: string; points: number }[],
) {
  const strongest = reasons
    .slice()
    .sort((a, b) => b.points - a.points)[0]?.reason;
  if (score >= 85)
    return `Potrivire excelentă: ${strongest || "site-ul confirmă un flux operațional complex"}, iar mai multe semnale verificate indică un beneficiu clar pentru recepția AI.`;
  if (score >= 65)
    return `Potrivire bună: ${strongest || "există nevoi relevante"}, însă lipsesc câteva semnale necesare pentru o prioritate maximă.`;
  if (score >= 40)
    return `Potrivire moderată: ${strongest || "specialitatea este relevantă"}, dar valoarea operațională trebuie validată înainte de contactare.`;
  return "Potrivire slabă sau insuficient documentată: site-ul nu confirmă destule semnale pentru o abordare personalizată sigură.";
}

function evaluationFlags(lead: Row<"leads">, duplicates: Row<"leads">[]) {
  const flags: string[] = [];
  if (!lead.website) flags.push("Website lipsă");
  if (!lead.email && !lead.phone) flags.push("Canal de contact lipsă");
  if (
    lead.email &&
    /@(website\.com|gmail\.com|yahoo\.|outlook\.|hotmail\.)/i.test(lead.email)
  )
    flags.push("Adresa de email este generică sau necesită confirmare manuală");
  if (duplicates.length) flags.push("Posibil duplicat");
  const facts =
    lead.verified_facts &&
    typeof lead.verified_facts === "object" &&
    !Array.isArray(lead.verified_facts)
      ? lead.verified_facts
      : {};
  const labels: Record<string, string> = {
    niche: "specialitate",
    city: "oraș",
    hours: "program",
    phone_booking: "programări telefonice",
    online_booking: "programare online",
    multiple_doctors: "număr de medici",
    limited_hours: "program limitat",
    no_visible_automation: "automatizare existentă",
    personalization: "fapt de personalizare",
  };
  const uncertain = Object.entries(labels)
    .filter(([key]) => facts[key] == null)
    .map(([, label]) => label);
  if (uncertain.length)
    flags.push(`Fapte neconfirmate: ${uncertain.join(", ")}`);
  return flags;
}

export async function runAiEvaluationBatch(
  organizationId: string,
  actorId: string,
  leadIds: string[],
) {
  const origin = new URL(appUrl());
  if (
    !["localhost", "127.0.0.1", "[::1]"].includes(origin.hostname) ||
    process.env.EMAIL_DELIVERY_MODE === "live"
  )
    throw new Error(
      "Evaluarea de lot rulează numai local, cu EMAIL_DELIVERY_MODE=log.",
    );
  if (!process.env.GEMINI_API_KEY)
    throw new Error("Google Gemini nu este configurat.");
  const ids = z.array(z.uuid()).min(1).max(10).parse(leadIds);
  const root = admin();
  const leads = check(
    await root
      .from("leads")
      .select("*")
      .eq("organization_id", organizationId)
      .in("id", ids),
  );
  if (leads.length !== ids.length) throw new Error("Prospect inaccesibil.");
  if (leads.some((lead) => lead.do_not_contact))
    throw new Error("Lotul include un prospect aflat pe lista de suprimare.");
  const runningEnrichment = check(
    await root
      .from("automation_jobs")
      .select("id")
      .eq("organization_id", organizationId)
      .eq("kind", "enrich_new_leads")
      .eq("status", "running")
      .in("lead_id", ids),
  );
  if (runningEnrichment.length)
    throw new Error(
      "Un prospect este deja analizat de worker. Reîncearcă după finalizare.",
    );
  check(
    await root
      .from("automation_jobs")
      .update({
        status: "cancelled",
        completed_at: new Date().toISOString(),
        last_error: "Înlocuit de evaluarea controlată cu două variante.",
      })
      .eq("organization_id", organizationId)
      .eq("kind", "enrich_new_leads")
      .eq("status", "pending")
      .in("lead_id", ids),
  );

  const reviewName = "Evaluare controlată · revizuire ciorne";
  let campaign = check(
    await root
      .from("campaigns")
      .select("*")
      .eq("organization_id", organizationId)
      .eq("name", reviewName)
      .neq("status", "archived")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  );
  if (!campaign)
    campaign = check(
      await root
        .from("campaigns")
        .insert({
          organization_id: organizationId,
          name: reviewName,
          niche: null,
          cities: [],
          target_filters: { source: "evaluare-controlata" },
          sender_identity: "dry-run@voxatech.example.invalid",
          tone: "profesional, concis",
          offer: "Evaluare internă; trimiterea este dezactivată.",
          daily_cap: 10,
          mode: "approval_required",
          status: "draft",
          first_message: "Variantă selectată manual după revizuire.",
          follow_up_1: "",
          follow_up_2: "",
        })
        .select()
        .single(),
    );
  campaign = check(
    await root
      .from("campaigns")
      .update({
        niche: null,
        cities: [],
        target_filters: { source: "evaluare-controlata" },
      })
      .eq("organization_id", organizationId)
      .eq("id", campaign.id)
      .select()
      .single(),
  );
  check(
    await root.rpc("assign_leads_to_campaign", {
      org: organizationId,
      target_campaign: campaign.id,
      target_leads: ids,
    }),
  );
  check(
    await root
      .from("messages")
      .update({ follow_up_number: null })
      .eq("organization_id", organizationId)
      .eq("campaign_id", campaign.id)
      .eq("status", "draft")
      .contains("metadata", { dry_run_review: true }),
  );

  const allOrgLeads = check(
    await root.from("leads").select("*").eq("organization_id", organizationId),
  );
  const results: Array<Record<string, unknown>> = [];
  for (const original of leads) {
    const previous = check(
      await root
        .from("activities")
        .select("details")
        .eq("organization_id", organizationId)
        .eq("lead_id", original.id)
        .eq("action", "ai_batch_evaluation")
        .contains("details", {
          campaign_id: campaign.id,
          copy_version: outreachCopyVersion,
        })
        .limit(1)
        .maybeSingle(),
    );
    if (previous) {
      const previousDetails =
        previous.details &&
        typeof previous.details === "object" &&
        !Array.isArray(previous.details)
          ? previous.details
          : {};
      results.push({ lead_id: original.id, reused: true, ...previousDetails });
      continue;
    }
    const extraFlags: string[] = [];
    const existingResearch = check(
      await root
        .from("activities")
        .select("details")
        .eq("organization_id", organizationId)
        .eq("lead_id", original.id)
        .eq("action", "ai_research")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
    );
    if (!existingResearch && original.website) {
      try {
        const text = await readPublicWebsite(original.website);
        await enrichFromText(
          { organization_id: organizationId },
          original,
          text,
          true,
        );
      } catch (error) {
        extraFlags.push(`Website indisponibil: ${safeError(error)}`);
        check(
          await root
            .from("leads")
            .update({
              status: "READY_FOR_OUTREACH",
              website_summary:
                "Website indisponibil la evaluare. Nu au fost adăugate fapte neverificate.",
              lead_score: 0,
              lead_temperature: "cold",
              score_reasons: [],
              enriched_at: new Date().toISOString(),
            })
            .eq("organization_id", organizationId)
            .eq("id", original.id),
        );
      }
    } else if (!existingResearch && !original.website) {
      await enrich(
        {
          organization_id: organizationId,
          lead_id: original.id,
          payload: {},
        } as Job,
        original,
      );
    }
    let lead = check(
      await root
        .from("leads")
        .select("*")
        .eq("organization_id", organizationId)
        .eq("id", original.id)
        .single(),
    );
    const existingMessages = check(
      await root
        .from("messages")
        .select("metadata")
        .eq("organization_id", organizationId)
        .eq("lead_id", lead.id)
        .eq("campaign_id", campaign.id)
        .eq("direction", "outbound"),
    );
    const hasVariant = (variant: "A" | "B") =>
      existingMessages.some((message) => {
        const metadata = message.metadata;
        return (
          metadata &&
          typeof metadata === "object" &&
          !Array.isArray(metadata) &&
          metadata.outreach_variant === variant &&
          metadata.copy_version === outreachCopyVersion
        );
      });
    if (!hasVariant("A") && !hasVariant("B"))
      await draftPair(
        {
          organization_id: organizationId,
          lead_id: lead.id,
          payload: { campaign_id: campaign.id },
        } as unknown as Job,
        lead,
        true,
      );
    else if (!hasVariant("A"))
      await draft(
        {
          organization_id: organizationId,
          lead_id: lead.id,
          payload: { campaign_id: campaign.id, variant: "A" },
        } as unknown as Job,
        lead,
        true,
      );
    else if (!hasVariant("B"))
      await draft(
        {
          organization_id: organizationId,
          lead_id: lead.id,
          payload: { campaign_id: campaign.id, variant: "B" },
        } as unknown as Job,
        lead,
        true,
      );
    lead = check(
      await root
        .from("leads")
        .select("*")
        .eq("organization_id", organizationId)
        .eq("id", original.id)
        .single(),
    );
    const duplicates = allOrgLeads.filter(
      (candidate) =>
        candidate.id !== lead.id &&
        ((lead.normalized_email &&
          candidate.normalized_email === lead.normalized_email) ||
          (lead.normalized_phone &&
            candidate.normalized_phone === lead.normalized_phone) ||
          (lead.normalized_website &&
            candidate.normalized_website === lead.normalized_website) ||
          candidate.normalized_company_city === lead.normalized_company_city),
    );
    const reasons = z
      .array(z.object({ reason: z.string(), points: z.number() }))
      .catch([])
      .parse(lead.score_reasons);
    const researchTrace = check(
      await root
        .from("activities")
        .select("details")
        .eq("organization_id", organizationId)
        .eq("lead_id", lead.id)
        .eq("action", "ai_research")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
    );
    const reviewMessages = check(
      await root
        .from("messages")
        .select("metadata")
        .eq("organization_id", organizationId)
        .eq("lead_id", lead.id)
        .eq("campaign_id", campaign.id)
        .eq("direction", "outbound"),
    );
    const currentReviewMetadata = reviewMessages
      .map((message) => message.metadata)
      .filter(
        (metadata) =>
          metadata &&
          typeof metadata === "object" &&
          !Array.isArray(metadata) &&
          metadata.copy_version === outreachCopyVersion,
      );
    const costObjects = [
      researchTrace?.details,
      ...currentReviewMetadata,
    ].filter(
      (value): value is Record<string, Json | undefined> =>
        !!value && typeof value === "object" && !Array.isArray(value),
    );
    const cost = costObjects.reduce(
      (sum, item) => sum + Number(item.estimated_cost_usd || 0),
      0,
    );
    const tokens = costObjects.reduce((sum, item) => {
      const usage = item.usage || item.token_usage;
      return (
        sum +
        (usage && typeof usage === "object" && !Array.isArray(usage)
          ? Number(usage.total_tokens || 0)
          : 0)
      );
    }, 0);
    const flags = [...evaluationFlags(lead, duplicates), ...extraFlags];
    const details = {
      campaign_id: campaign.id,
      dry_run: true,
      delivery_attempted: false,
      fit: evaluationFit(lead.lead_score || 0, reasons),
      flags,
      estimated_cost_usd: cost,
      total_tokens: tokens,
      variants: ["A", "B"],
      primary_variant: "B",
      copy_version: outreachCopyVersion,
      provider: "google_gemini",
      model: process.env.DEFAULT_AUTOMATION_MODEL || "gemini-3.8-flash",
      thinking_level: "low",
    };
    await log(
      organizationId,
      "ai_batch_evaluation",
      lead.id,
      details,
      process.env.DEFAULT_AUTOMATION_MODEL || "gemini-3.8-flash",
      actorId,
    );
    results.push({
      lead_id: lead.id,
      company_name: lead.company_name,
      ...details,
    });
  }
  const total = results.reduce(
    (sum, item) => sum + Number(item.estimated_cost_usd || 0),
    0,
  );
  return {
    campaign,
    results,
    totals: { leads: results.length, estimated_cost_usd: total },
    safeguards: {
      delivery_mode: "log",
      campaign_status: campaign.status,
      campaign_activated: false,
      delivery_attempted: false,
    },
  };
}

export async function regenerateReviewDraft(
  organizationId: string,
  actorId: string,
  messageId: string,
) {
  const root = admin();
  const message = check(
    await root
      .from("messages")
      .select("*")
      .eq("organization_id", organizationId)
      .eq("id", z.uuid().parse(messageId))
      .single(),
  );
  const metadata =
    message.metadata &&
    typeof message.metadata === "object" &&
    !Array.isArray(message.metadata)
      ? message.metadata
      : {};
  if (
    message.direction !== "outbound" ||
    metadata.outreach_variant !== "B" ||
    !message.campaign_id ||
    !["draft", "approved"].includes(message.status)
  )
    throw new Error("Numai Varianta B aflată în review poate fi regenerată.");
  const campaign = check(
    await root
      .from("campaigns")
      .select("status")
      .eq("organization_id", organizationId)
      .eq("id", message.campaign_id)
      .single(),
  );
  if (campaign.status === "active")
    throw new Error("Pune campania în pauză înainte de regenerare.");
  const lead = check(
    await root
      .from("leads")
      .select("*")
      .eq("organization_id", organizationId)
      .eq("id", message.lead_id)
      .single(),
  );
  await draft(
    {
      organization_id: organizationId,
      lead_id: lead.id,
      payload: { campaign_id: message.campaign_id, variant: "B" },
    } as unknown as Job,
    lead,
    true,
  );
  await log(
    organizationId,
    "message_regenerate",
    lead.id,
    { message_id: message.id, campaign_id: message.campaign_id },
    process.env.DEFAULT_AUTOMATION_MODEL || "gemini-3.8-flash",
    actorId,
  );
  return check(
    await root
      .from("messages")
      .select("*")
      .eq("organization_id", organizationId)
      .eq("id", message.id)
      .single(),
  );
}

const controlledWebsiteContent = `
Clinica Aurora este o clinică fictivă de dermatologie și medicină estetică din Brașov.
Echipa clinicii este formată din patru medici specialiști.
Servicii: consultații dermatologice, dermatoscopie, tratamente pentru acnee și proceduri de medicină estetică.
Program: luni–vineri, 08:00–17:00. Clinica este închisă sâmbăta și duminica.
Programările se fac prin telefon la 0268 555 014.
Nu oferim programări online și nu folosim chatbot sau recepție automatizată.
În fiecare miercuri există un interval dedicat consultațiilor pentru adolescenți.
`.trim();

export async function runControlledAiTest(
  organizationId: string,
  actorId: string,
) {
  const origin = new URL(appUrl());
  if (
    !["localhost", "127.0.0.1", "[::1]"].includes(origin.hostname) ||
    process.env.EMAIL_DELIVERY_MODE === "live"
  )
    throw new Error(
      "Testul AI controlat rulează numai local, cu EMAIL_DELIVERY_MODE=log.",
    );
  if (!process.env.GEMINI_API_KEY)
    throw new Error(
      "Google Gemini neconfigurat. Adaugă GEMINI_API_KEY în .env.local.",
    );
  if (process.env.DEFAULT_AUTOMATION_MODEL !== "gemini-3.8-flash")
    throw new Error("Testul cere DEFAULT_AUTOMATION_MODEL=gemini-3.8-flash.");
  if (process.env.AI_PROVIDER !== "google_gemini")
    throw new Error("Testul cere AI_PROVIDER=google_gemini.");

  const suffix = crypto.randomUUID().slice(0, 8);
  const root = admin();
  let lead = check(
    await root
      .from("leads")
      .select("*")
      .eq("organization_id", organizationId)
      .eq("source", "ai-controlled-test")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  );
  if (!lead)
    lead = check(
      await root
        .from("leads")
        .insert({
          organization_id: organizationId,
          company_name: `Clinica Aurora · test AI ${suffix}`,
          city: "Brașov",
          country: "RO",
          website: `https://clinica-aurora-${suffix}.example`,
          email: `contact+${suffix}@clinica-aurora.example`,
          source: "ai-controlled-test",
          notes:
            "Prospect complet fictiv creat pentru testul controlat al stratului AI.",
        })
        .select()
        .single(),
    );
  const completedActions = check(
    await root
      .from("activities")
      .select("action")
      .eq("organization_id", organizationId)
      .eq("lead_id", lead.id)
      .in("action", ["ai_research", "ai_outreach"]),
  );
  if (!completedActions.some((activity) => activity.action === "ai_research")) {
    check(
      await root
        .from("leads")
        .update({ status: "ENRICHING" })
        .eq("organization_id", organizationId)
        .eq("id", lead.id),
    );
    await enrichFromText(
      { organization_id: organizationId },
      lead,
      controlledWebsiteContent,
      true,
    );
  }
  lead = check(
    await root
      .from("leads")
      .select("*")
      .eq("organization_id", organizationId)
      .eq("id", lead.id)
      .single(),
  );
  if (!completedActions.some((activity) => activity.action === "ai_outreach"))
    await draft(
      {
        organization_id: organizationId,
        lead_id: lead.id,
        payload: {},
      } as Job,
      lead,
      true,
    );
  const message = check(
    await root
      .from("messages")
      .select("*")
      .eq("organization_id", organizationId)
      .eq("lead_id", lead.id)
      .eq("direction", "outbound")
      .single(),
  );
  if (message.status !== "draft" || message.provider_message_id)
    throw new Error(
      "Testul a refuzat un rezultat care nu este o ciornă locală.",
    );
  const activities = check(
    await root
      .from("activities")
      .select("id,action,model,details,created_at")
      .eq("organization_id", organizationId)
      .eq("lead_id", lead.id)
      .in("action", ["ai_research", "ai_outreach"])
      .order("created_at"),
  );
  if (
    activities.length !== 2 ||
    activities.some((activity) => {
      const details = activity.details;
      return (
        !details ||
        Array.isArray(details) ||
        typeof details !== "object" ||
        !("input" in details) ||
        !("output" in details) ||
        !("usage" in details)
      );
    })
  )
    throw new Error(
      "Jurnalul AI nu conține trasabilitatea completă a testului.",
    );
  await log(
    organizationId,
    "ai_controlled_test_completed",
    lead.id,
    {
      dry_run: true,
      synthetic_content: true,
      message_id: message.id,
      campaign_id: null,
      delivery_attempted: false,
    },
    null,
    actorId,
  );
  return {
    lead,
    message,
    activities,
    safeguards: {
      delivery_mode: "log",
      campaign_created: false,
      campaign_activated: false,
      delivery_attempted: false,
      source: "synthetic website content",
    },
  };
}

export async function schedule(organization?: string) {
  const configs = check(
    await admin()
      .from("gmail_autopilot_settings")
      .select("organization_id")
      .eq("enabled", true),
  );
  for (const cfg of configs)
    if (!organization || cfg.organization_id === organization)
      check(
        await admin().rpc("schedule_gmail_autopilot", {
          org: cfg.organization_id,
        }),
      );
  check(
    await admin().rpc("schedule_due_jobs", {
      target_org: organization,
      delivery_mode:
        process.env.EMAIL_DELIVERY_MODE === "live" ? "live" : "log",
    }),
  );
}
export async function runWorker(organization?: string) {
  await syncGmail(organization);
  await schedule(organization);
  const results = [];
  const started = Date.now();
  for (let i = 0; i < 8 && Date.now() - started < 80000; i++) {
    const job = check(
      await admin().rpc("claim_organization_job", { target_org: organization }),
    )[0];
    if (!job) break;
    try {
      await runJob(job);
      const finished = check(
        await admin().rpc("finish_automation_job", {
          job_id: job.id,
          token: job.lock_token!,
        }),
      );
      if (!finished)
        throw new Error("Lease expired; result needs reconciliation.");
      results.push({ id: job.id, ok: true });
    } catch (error) {
      if (error instanceof DeferredSend) {
        check(
          await admin().rpc("defer_automation_job", {
            job_id: job.id,
            token: job.lock_token!,
          }),
        );
        results.push({ id: job.id, deferred: true });
        continue;
      }
      const message = safeError(error);
      check(
        await admin().rpc("finish_automation_job", {
          job_id: job.id,
          token: job.lock_token!,
          failure: message.slice(0, 500),
        }),
      );
      if (job.lead_id && job.attempts >= job.max_attempts) {
        const target = check(
          await admin()
            .from("leads")
            .select("*")
            .eq("id", job.lead_id)
            .eq("organization_id", job.organization_id)
            .single(),
        );
        await attention(
          job.organization_id,
          target,
          `Automatizarea ${job.kind} a eșuat după ${job.attempts} încercări: ${message}`,
        );
      }
      results.push({ id: job.id, ok: false });
    }
  }
  return results;
}
