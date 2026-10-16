import { createClient } from "@supabase/supabase-js";
import { required } from "./shared.mjs";
import {
  approvedOutreachTemplate,
  outreachCopyVersion,
  outreachInstructions,
  validateOutreach,
} from "../src/lib/outreach-template.ts";
import { optOutLine } from "../src/lib/launch.ts";
import { GoogleGeminiProvider, safetyPrompt } from "../src/lib/providers/ai.ts";
import { z } from "zod";
import { writeFile } from "node:fs/promises";
if (required("EMAIL_DELIVERY_MODE") !== "log")
  throw new Error("Draft-only phase");
const db = createClient(
  required("NEXT_PUBLIC_SUPABASE_URL"),
  required("SUPABASE_SERVICE_ROLE_KEY"),
  { auth: { persistSession: false, autoRefreshToken: false } },
);
const org = "10000000-0000-4000-8000-000000000001";
const checked = (r) => {
  if (r.error) throw new Error(`Database: ${r.error.code}`);
  return r.data;
};
const leads = checked(
  await db
    .from("leads")
    .select("id,company_name,website")
    .eq("organization_id", org)
    .eq("source", "evaluare-controlata")
    .eq("do_not_contact", false),
);
const drafts = checked(
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
).filter((m) => m.metadata?.outreach_variant);
let updated = 0;
for (const m of drafts) {
  const l = leads.find((l) => l.id === m.lead_id);
  if (m.metadata?.copy_version === outreachCopyVersion) continue;
  const body = approvedOutreachTemplate
    .replace(
      "un demo scurt și vedeți",
      `un demo scurt pentru ${l.company_name} și vedeți`,
    )
    .replace("\n\nCu respect,", `\n\n${optOutLine}\n\nCu respect,`);
  validateOutreach(body, l.company_name);
  const previous = {
    body: m.body,
    subject: m.subject,
    model: m.model,
    copy_version: m.metadata?.copy_version,
  };
  const metadata = {
    ...m.metadata,
    copy_version: outreachCopyVersion,
    template_source: "owner_provided",
    reply_to: "contact@voxatech.ro",
    fact_used: null,
    prior_copy: previous,
    review_state: "draft",
    last_test_sent_at: null,
    last_test_provider_id: null,
  };
  delete metadata.token_usage;
  delete metadata.estimated_cost_usd;
  delete metadata.provider;
  checked(
    await db
      .from("messages")
      .update({
        body,
        subject: `30 de zile gratuite cu Voxa pentru ${l.company_name}`,
        model: null,
        metadata,
      })
      .eq("id", m.id)
      .eq("status", "draft")
      .is("approved_by", null)
      .is("sent_at", null),
  );
  updated++;
}
const evidence = {
  project: "voxa-growth",
  updatedOwnerTemplateDrafts: updated,
  emailsSent: 0,
  autopilotStillPaused: true,
  manualGeminiVerification: null,
};
// One explicit verification generation, bounded below $0.05 using configured prices.
// It does not enable Autopilot, alter its budget, or queue delivery.
if (process.argv.includes("--verify-gemini") && drafts.length) {
  const m =
    drafts.find((m) => m.metadata?.outreach_variant === "B") || drafts[0];
  const l = leads.find((l) => l.id === m.lead_id);
  const cfg = Object.fromEntries(
    checked(
      await db.from("settings").select("key,value").eq("organization_id", org),
    ).map((r) => [r.key, r.value]),
  );
  const model = cfg.ai_models?.default || required("DEFAULT_AUTOMATION_MODEL");
  const prompt =
    outreachInstructions(l.company_name, optOutLine) +
    "\nPentru această verificare personalizează numai numele clinicii; nu adăuga cercetare.";
  const schema = z.object({ subject: z.string(), body: z.string() });
  const pricing = {
    inputPerMillion:
      cfg.costs?.input_per_million ??
      Number(required("GEMINI_INPUT_COST_PER_MILLION")),
    outputPerMillion:
      cfg.costs?.output_per_million ??
      Number(required("GEMINI_OUTPUT_COST_PER_MILLION")),
  };
  const maxCost =
    ((Buffer.byteLength(
      prompt + safetyPrompt + JSON.stringify(z.toJSONSchema(schema)),
    ) +
      4096) *
      pricing.inputPerMillion +
      2500 * pricing.outputPerMillion) /
    1e6;
  if (!Number.isFinite(maxCost) || maxCost > 0.05)
    throw new Error("Manual verification estimate exceeds $0.05");
  const generated = await new GoogleGeminiProvider().generate({
    model,
    system: safetyPrompt,
    prompt,
    schema,
    name: "voxa_template_verification",
    thinkingLevel: "low",
    pricing,
    limits: { timeoutMs: 30000, maxOutputTokens: 2500, attempts: 1 },
  });
  validateOutreach(generated.value.body, l.company_name);
  if (
    !generated.value.body.includes(optOutLine) ||
    generated.value.subject !==
      `30 de zile gratuite cu Voxa pentru ${l.company_name}`
  )
    throw new Error("Generated draft failed approved copy policy");
  const current = checked(
    await db.from("messages").select("metadata").eq("id", m.id).single(),
  );
  checked(
    await db
      .from("messages")
      .update({
        ...generated.value,
        model: generated.model,
        metadata: {
          ...current.metadata,
          template_source: "owner_provided_gemini_personalized",
          provider: generated.provider,
          token_usage: generated.usage,
          estimated_cost_usd: generated.estimatedCostUsd,
        },
      })
      .eq("id", m.id)
      .eq("status", "draft")
      .is("approved_by", null)
      .is("sent_at", null),
  );
  evidence.manualGeminiVerification = {
    leadId: l.id,
    sourceUrl: l.website,
    messageId: m.id,
    model: generated.model,
    usage: generated.usage,
    costUsd: generated.estimatedCostUsd,
    status: "draft",
    approved: false,
  };
}
await writeFile(
  new URL("../verification-voxa-pitch.local.json", import.meta.url),
  JSON.stringify(evidence, null, 2),
);
console.log(JSON.stringify(evidence, null, 2));
