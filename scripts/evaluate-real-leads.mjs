import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { z } from "zod";
import { createClient } from "@supabase/supabase-js";
import { createServerClient } from "@supabase/ssr";
import { required } from "./shared.mjs";

const origin = process.env.APP_URL || "http://localhost:3000";
if (!["localhost", "127.0.0.1", "[::1]"].includes(new URL(origin).hostname))
  throw new Error("Evaluarea a fost refuzată: APP_URL trebuie să fie local.");
assert.notEqual(process.env.EMAIL_DELIVERY_MODE, "live");
assert.equal(process.env.AI_PROVIDER, "google_gemini");
assert.equal(process.env.DEFAULT_AUTOMATION_MODEL, "gemini-3.8-flash");
required("GEMINI_API_KEY");

const leadInputPath = new URL("./evaluation-leads.local.json", import.meta.url);
const leadInput = z.array(
  z.object({
    company_name: z.string().min(1),
    website: z.url(),
    email: z.email(),
    phone: z.string().min(6),
    notes: z.string(),
    google_rating: z.number().min(0).max(5),
    review_count: z.number().int().nonnegative(),
  }),
);
const leads = leadInput
  .parse(JSON.parse(await readFile(leadInputPath, "utf8")))
  .map((lead) => ({
    ...lead,
    niche: "Stomatologie",
    city: "Brașov",
    country: "RO",
    source: "evaluare-controlata",
  }));

const service = createClient(
  required("NEXT_PUBLIC_SUPABASE_URL"),
  required("SUPABASE_SERVICE_ROLE_KEY"),
  { auth: { persistSession: false, autoRefreshToken: false } },
);
const adminEmail = required("VOXA_ADMIN_EMAIL");
const { data: link, error: linkError } = await service.auth.admin.generateLink({
  type: "magiclink",
  email: adminEmail,
});
if (linkError) throw linkError;
const jar = new Map();
const user = createServerClient(
  required("NEXT_PUBLIC_SUPABASE_URL"),
  required("NEXT_PUBLIC_SUPABASE_ANON_KEY"),
  {
    cookies: {
      getAll: () => [...jar].map(([name, value]) => ({ name, value })),
      setAll: (items) => items.forEach(({ name, value }) => jar.set(name, value)),
    },
  },
);
const auth = await user.auth.verifyOtp({
  token_hash: link.properties.hashed_token,
  type: "magiclink",
});
if (auth.error) throw auth.error;
const cookie = () =>
  [...jar].map(([name, value]) => `${name}=${value}`).join("; ");
async function action(actionName, data) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const response = await fetch(`${origin}/api/actions`, {
      method: "POST",
      headers: {
        Origin: new URL(origin).origin,
        Cookie: cookie(),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ action: actionName, data }),
    });
    const body = await response.json();
    if (response.ok) return body;
    const message = String(body.error || "eroare");
    if (response.status === 400 && /429|RESOURCE_EXHAUSTED|quota/i.test(message)) {
      console.error("Limită Gemini atinsă; reiau etapa peste 60 de secunde.");
      await new Promise((resolve) => setTimeout(resolve, 60_000));
      continue;
    }
    throw new Error(`${actionName} (${response.status}): ${message}`);
  }
  throw new Error(
    `${actionName}: cota Gemini Free Tier este epuizată; reia după resetarea zilnică.`,
  );
}

const existing = await service
  .from("leads")
  .select("id,company_name,source")
  .eq("source", "evaluare-controlata");
if (existing.error) throw existing.error;
const existingNames = new Map(
  (existing.data || []).map((lead) => [lead.company_name, lead.id]),
);
const missing = leads.filter((lead) => !existingNames.has(lead.company_name));
if (missing.length) {
  const imported = await action("import", missing);
  if (imported.errors.length)
    throw new Error(`Import incomplet: ${JSON.stringify(imported.errors)}`);
}
const batchRows = await service
  .from("leads")
  .select("id,company_name")
  .eq("source", "evaluare-controlata")
  .in(
    "company_name",
    leads.map((lead) => lead.company_name),
  );
if (batchRows.error) throw batchRows.error;
assert.equal(batchRows.data.length, 10, "Lotul trebuie să conțină exact 10 prospecte.");
const completed = [];
let campaign;
for (const [index, lead] of batchRows.data.entries()) {
  const partial = await action("ai_evaluation_batch", { ids: [lead.id] });
  assert.equal(partial.safeguards.delivery_mode, "log");
  assert.equal(partial.safeguards.campaign_status, "draft");
  assert.equal(partial.safeguards.delivery_attempted, false);
  assert.equal(partial.results.length, 1);
  campaign = partial.campaign;
  completed.push(partial.results[0]);
  console.error(`Evaluat ${index + 1}/10: ${lead.company_name}`);
}
console.log(
  JSON.stringify(
    {
      campaign,
      results: completed,
      totals: {
        leads: completed.length,
        estimated_cost_usd: completed.reduce(
          (sum, item) => sum + Number(item.estimated_cost_usd || 0),
          0,
        ),
      },
      safeguards: {
        delivery_mode: "log",
        campaign_status: campaign.status,
        campaign_activated: false,
        delivery_attempted: false,
      },
    },
    null,
    2,
  ),
);
