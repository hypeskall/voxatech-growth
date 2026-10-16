// Regenerate only unapproved evaluation drafts. Never enables delivery or sends mail.
import { createClient } from "@supabase/supabase-js";
import { required } from "./shared.mjs";
import {
  buildLeadContext,
  generateOutreach,
  outreachCopyVersion,
  outreachOutputSchema,
  outreachSystemPrompt,
} from "../src/lib/outreach-template.ts";
import { GoogleGeminiProvider, safetyPrompt } from "../src/lib/providers/ai.ts";
if (required("EMAIL_DELIVERY_MODE") !== "log")
  throw new Error("Draft-only phase");
const db = createClient(
  required("NEXT_PUBLIC_SUPABASE_URL"),
  required("SUPABASE_SERVICE_ROLE_KEY"),
  { auth: { persistSession: false, autoRefreshToken: false } },
);
const checked = (r) => {
  if (r.error) throw new Error(`Database: ${r.error.code}`);
  return r.data;
};
const org = "10000000-0000-4000-8000-000000000001";
const leads = checked(
  await db
    .from("leads")
    .select("*")
    .eq("organization_id", org)
    .eq("source", "evaluare-controlata")
    .eq("do_not_contact", false),
);
const drafts = leads.length
  ? checked(
      await db
        .from("messages")
        .select("*")
        .eq("organization_id", org)
        .eq("direction", "outbound")
        .eq("status", "draft")
        .is("approved_by", null)
        .is("sent_at", null)
        .in(
          "lead_id",
          leads.map((l) => l.id),
        ),
    ).filter(
      (m) =>
        m.metadata?.outreach_variant &&
        m.metadata?.copy_version !== outreachCopyVersion,
    )
  : [];
if (
  !process.argv.includes("--regenerate") &&
  !process.argv.includes("--verify-gemini")
) {
  console.log(
    JSON.stringify({
      eligibleDrafts: drafts.length,
      changed: 0,
      emailsSent: 0,
      note: "Use --regenerate (up to 10 drafts) or --verify-gemini (one draft).",
    }),
  );
} else {
  const cfg = Object.fromEntries(
    checked(
      await db.from("settings").select("key,value").eq("organization_id", org),
    ).map((r) => [r.key, r.value]),
  );
  const pricing = {
    inputPerMillion:
      cfg.costs?.input_per_million ??
      Number(required("GEMINI_INPUT_COST_PER_MILLION")),
    outputPerMillion:
      cfg.costs?.output_per_million ??
      Number(required("GEMINI_OUTPUT_COST_PER_MILLION")),
  };
  if (
    !Number.isFinite(pricing.inputPerMillion) ||
    !Number.isFinite(pricing.outputPerMillion) ||
    pricing.inputPerMillion > 1 ||
    pricing.outputPerMillion > 5
  )
    throw new Error("Review model prices before bulk regeneration.");
  let changed = 0,
    cost = 0;
  for (const m of drafts.slice(
    0,
    process.argv.includes("--verify-gemini") ? 1 : 10,
  )) {
    const lead = leads.find((l) => l.id === m.lead_id),
      context = buildLeadContext(lead);
    const r = await generateOutreach({
      context,
      generate: (prompt, attempt) =>
        new GoogleGeminiProvider().generate({
          model: cfg.ai_models?.default || required("DEFAULT_AUTOMATION_MODEL"),
          system: safetyPrompt + "\n" + outreachSystemPrompt,
          prompt,
          schema: outreachOutputSchema,
          name: "outreach",
          thinkingLevel: attempt === 0 ? "minimal" : "low",
          pricing,
          limits: { timeoutMs: 30000, maxOutputTokens: 2200, attempts: 1 },
        }),
    });
    checked(
      await db
        .from("messages")
        .update({
          subject: r.value.subject,
          body: r.value.body,
          model: r.model,
          metadata: {
            ...m.metadata,
            prior_copy: {
              subject: m.subject,
              body: m.body,
              copy_version: m.metadata?.copy_version,
            },
            copy_version: outreachCopyVersion,
            selected_offer: r.value.selected_offer,
            personalization_reason: r.value.personalization_reason,
            fact_used: r.value.fact_used,
            automatic_unsubscribe: true,
            provider: r.provider,
            token_usage: r.usage,
            estimated_cost_usd: r.estimatedCostUsd,
            review_state: "draft",
            last_test_sent_at: null,
            last_test_provider_id: null,
          },
        })
        .eq("organization_id", org)
        .eq("id", m.id)
        .eq("status", "draft")
        .is("approved_by", null)
        .is("sent_at", null),
    );
    changed++;
    cost += r.estimatedCostUsd;
  }
  console.log(
    JSON.stringify({
      changed,
      costUsd: cost,
      emailsSent: 0,
      deliveryMode: "log",
    }),
  );
}
