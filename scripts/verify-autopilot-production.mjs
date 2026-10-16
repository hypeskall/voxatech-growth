import { createClient } from "@supabase/supabase-js";
import { createServerClient } from "@supabase/ssr";
import { required, management } from "./shared.mjs";
import { readFile, writeFile } from "node:fs/promises";
import assert from "node:assert/strict";
const origin = "https://voxa-growth.vercel.app";
const evidence = {
  project: "voxa-growth",
  url: `${origin}/autopilot`,
  testedAt: new Date().toISOString(),
};
const denied = await fetch(origin + "/api/autopilot");
assert.equal(denied.status, 401);
evidence.unauthenticatedSettingsDenied = denied.status;
const cronDenied = await fetch(origin + "/api/autopilot/cron");
assert.equal(cronDenied.status, 401);
evidence.unauthenticatedSchedulerDenied = cronDenied.status;
const root = createClient(
  required("NEXT_PUBLIC_SUPABASE_URL"),
  required("SUPABASE_SERVICE_ROLE_KEY"),
  { auth: { persistSession: false, autoRefreshToken: false } },
);
const { data: link, error } = await root.auth.admin.generateLink({
  type: "magiclink",
  email: required("VOXA_ADMIN_EMAIL"),
});
if (error) throw new Error("Could not create an unsent verification session");
const jar = new Map();
const client = createServerClient(
  required("NEXT_PUBLIC_SUPABASE_URL"),
  required("NEXT_PUBLIC_SUPABASE_ANON_KEY"),
  {
    cookies: {
      getAll: () => Array.from(jar, ([name, value]) => ({ name, value })),
      setAll: (cookies) => cookies.forEach((c) => jar.set(c.name, c.value)),
    },
  },
);
const verified = await client.auth.verifyOtp({
  token_hash: link.properties.hashed_token,
  type: "magiclink",
});
if (verified.error)
  throw new Error("Verification session failed; no token logged");
const cookie = Array.from(
  jar,
  ([k, v]) => `${k}=${encodeURIComponent(v)}`,
).join("; ");
try {
  const response = await fetch(origin + "/api/autopilot", {
    headers: { Cookie: cookie },
  });
  const data = await response.json();
  assert.equal(response.status, 200);
  assert.equal(data.settings.enabled, false);
  assert.equal(data.delivery, "log");
  assert.equal(data.settings.daily_target, 10);
  assert.equal(data.scheduler.enabled, true);
  assert.equal(data.settings.input_mode, "supplied");
  assert.equal(data.replyTo, "contact@voxatech.ro");
  assert.ok(data.errors.every((e) => !/Brave|BRAVE/u.test(e)));
  evidence.authenticatedDashboard = {
    status: response.status,
    paused: !data.settings.enabled,
    dailyTarget: data.settings.daily_target,
    city: data.settings.city,
    specialty: data.settings.specialty,
    delivery: data.delivery,
    missingSetup: data.errors,
    scheduler: data.scheduler,
    productionRuns: data.runs.length,
    productionSources: data.candidates.length,
    inputMode: data.settings.input_mode,
    eligibleSuppliedLeads: data.leads.length,
    replyTo: data.replyTo,
  };
  const html = await fetch(origin + "/autopilot", {
    headers: { Cookie: cookie },
  });
  assert.equal(html.status, 200);
  assert.ok((await html.text()).includes("<title>Voxa</title>"));
  evidence.autopilotPage = html.status;
  const start = await fetch(origin + "/api/autopilot", {
    method: "POST",
    headers: {
      Cookie: cookie,
      Origin: origin,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ action: "start" }),
  });
  assert.equal(start.status, 400);
  evidence.unconfiguredStartRefused = start.status;
  const wrongOrigin = await fetch(origin + "/api/autopilot", {
    method: "POST",
    headers: {
      Cookie: cookie,
      Origin: "https://invalid.example",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ action: "pause" }),
  });
  assert.equal(wrongOrigin.status, 403);
  evidence.foreignOriginDenied = wrongOrigin.status;
  const cron = await fetch(origin + "/api/autopilot/cron", {
    headers: { Authorization: `Bearer ${required("AUTOPILOT_CRON_SECRET")}` },
  });
  const execution = await cron.json();
  assert.equal(cron.status, 200);
  assert.equal(execution.processed, 0);
  evidence.protectedWorker = { status: cron.status, ...execution };
  evidence.persistedPitch = await management("/database/query", "POST", {
    query: `select count(*) as owner_template_drafts,count(*) filter(where model is not null) as gemini_personalized_drafts,bool_and(status='draft' and approved_by is null and sent_at is null) as unapproved_unsent,bool_and(body like '%30 de zile de test complet gratuit, fără nicio obligație ulterior.%') as approved_trial_offer from public.messages where metadata->>'copy_version'='voxa-free-trial-v1'`,
  });
  evidence.geminiDraft = await management("/database/query", "POST", {
    query: `select l.company_name,l.website as source_url,m.id as draft_id,m.status,m.model,m.metadata->'estimated_cost_usd' as estimated_cost_usd from public.messages m join public.leads l on l.id=m.lead_id where m.metadata->>'template_source'='owner_provided_gemini_personalized'`,
  });
  const rows = await management("/database/query", "POST", {
    query: `select net.http_get(url:='${origin}/api/autopilot/cron',headers:=jsonb_build_object('Authorization','Bearer '||(select decrypted_secret from vault.decrypted_secrets where name='voxa_growth_autopilot_secret')),timeout_milliseconds:=110000) as request_id`,
  });
  evidence.schedulerTransportRequestId = rows[0].request_id;
  await new Promise((r) => setTimeout(r, 4000));
  const transport = await management("/database/query", "POST", {
    query: `select status_code,timed_out,error_msg,content from net._http_response where id=${Number(rows[0].request_id)}`,
  });
  if (transport.length) {
    assert.equal(transport[0].status_code, 200);
    evidence.schedulerTransport = transport[0];
  } else
    evidence.schedulerTransport =
      "Awaiting pg_net response; inspect request id";
} finally {
  await client.auth.signOut({ scope: "local" });
}
await writeFile(
  new URL("../verification-autopilot-production.local.json", import.meta.url),
  JSON.stringify(evidence, null, 2),
);
console.log(JSON.stringify(evidence, null, 2));
