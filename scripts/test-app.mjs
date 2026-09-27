import { createClient } from "@supabase/supabase-js";
import { createServerClient } from "@supabase/ssr";
import { required, management } from "./shared.mjs";
import assert from "node:assert/strict";
const origin = "http://localhost:3000";
if (process.env.EMAIL_DELIVERY_MODE === "live")
  throw new Error("HTTP tests require log delivery mode.");
const service = createClient(
  required("NEXT_PUBLIC_SUPABASE_URL"),
  required("SUPABASE_SERVICE_ROLE_KEY"),
  { auth: { persistSession: false, autoRefreshToken: false } },
);
const adminEmail = required("VOXA_ADMIN_EMAIL");
const { data: link, error } = await service.auth.admin.generateLink({
  type: "magiclink",
  email: adminEmail,
});
if (error) throw error;
const jar = new Map();
const user = createServerClient(
  required("NEXT_PUBLIC_SUPABASE_URL"),
  required("NEXT_PUBLIC_SUPABASE_ANON_KEY"),
  {
    cookies: {
      getAll: () => [...jar].map(([name, value]) => ({ name, value })),
      setAll: (items) => items.forEach((c) => jar.set(c.name, c.value)),
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
const source = `qa-http-${crypto.randomUUID()}`;
const ids = [];
let campaignId;
let docId;
async function action(action, data, expected = 200) {
  const r = await fetch(`${origin}/api/actions`, {
    method: "POST",
    headers: {
      Origin: origin,
      Cookie: cookie(),
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ action, data }),
  });
  const body = await r.json();
  assert.equal(r.status, expected, `${action}: ${body.error || ""}`);
  return body;
}
try {
  const h = await fetch(
    `${origin}/api/health/database?organization_id=10000000-0000-4000-8000-000000000001`,
    { headers: { Cookie: cookie() } },
  );
  assert.equal(h.status, 200);
  console.log("PASS authenticated database health");
  const noAuth = await fetch(`${origin}/api/snapshot`);
  assert.equal(noAuth.status, 401);
  console.log("PASS unauthenticated snapshot rejection");
  const lead = await action("lead_save", {
    lead: {
      company_name: source,
      city: "București",
      email: `${source}@example.invalid`,
      source,
    },
  });
  ids.push(lead.id);
  await action(
    "lead_save",
    {
      lead: {
        company_name: source + " duplicate",
        email: `${source}@example.invalid`,
        source,
      },
    },
    400,
  );
  console.log("PASS create and duplicate detection");
  await action("lead_save", {
    id: lead.id,
    lead: { company_name: source, source, notes: "Notițe verificate" },
  });
  const preserved = await service
    .from("leads")
    .select("email,notes")
    .eq("id", lead.id)
    .single();
  assert.equal(preserved.data.email, source + "@example.invalid");
  assert.equal(preserved.data.notes, "Notițe verificate");
  console.log("PASS notes preserve contact data");
  const imported = await action("import", [
    { company_name: source + " imported", city: "Cluj-Napoca", source },
    { company_name: source, source, email: `${source}@example.invalid` },
  ]);
  assert.equal(imported.inserted, 1);
  assert.equal(imported.errors.length, 1);
  console.log("PASS partial CSV import reports duplicate row");
  const qaRows = await service.from("leads").select("id").eq("source", source);
  for (const r of qaRows.data || []) if (!ids.includes(r.id)) ids.push(r.id);
  const run = await fetch(`${origin}/api/worker`, {
    method: "POST",
    headers: { Origin: origin, Cookie: cookie() },
  });
  assert.equal(run.status, 200);
  const researched = await service
    .from("leads")
    .select("status,enriched_at")
    .eq("id", lead.id)
    .single();
  assert.equal(researched.data.status, "READY_FOR_OUTREACH");
  assert.ok(researched.data.enriched_at);
  console.log("PASS queued enrichment, safe missing-website handling, worker");
  const c = await action("campaign_save", {
    campaign: {
      name: source,
      sender_identity: "test@example.invalid",
      tone: "profesional",
      offer: "Verificare",
      daily_cap: 10,
      window_start: "09:30",
      window_end: "16:30",
      mode: "approval_required",
      first_message: "Test",
      follow_up_1: "Test",
      follow_up_2: "Test",
    },
  });
  campaignId = c.id;
  await action("bulk_campaign", { ids: [lead.id], campaign_id: c.id });
  await action("campaign_status", { id: c.id, status: "active" });
  const activated = await service
    .from("campaigns")
    .select("activated_by")
    .eq("id", c.id)
    .single();
  assert.equal(activated.data.activated_by, auth.data.user.id);
  await action("campaign_status", { id: c.id, status: "paused" });
  console.log("PASS campaign association, explicit activation, pause");
  const doc = await action("knowledge_save", {
    title: source,
    category: "product",
    content: "Document temporar de verificare.",
    active: true,
  });
  docId = doc.id;
  await action("knowledge_save", {
    id: docId,
    title: source,
    category: "product",
    content: "Versiune revizuită de verificare.",
    active: true,
  });
  const versions = await service
    .from("knowledge_base_versions")
    .select("id")
    .eq("document_id", docId);
  assert.equal(versions.data.length, 2);
  await action("knowledge_delete", { id: docId });
  console.log("PASS knowledge versioning and soft deletion");
  await action("message_reply", {
    lead_id: lead.id,
    body: "Ciornă temporară, fără trimitere.",
  });
  const message = await service
    .from("messages")
    .select("id")
    .eq("lead_id", lead.id)
    .single();
  await action("message_approve", { id: message.data.id });
  await action("suppress", { ids: [lead.id] });
  const stopped = await service
    .from("messages")
    .select("status")
    .eq("id", message.data.id)
    .single();
  assert.equal(stopped.data.status, "cancelled");
  console.log("PASS draft, approval, suppression, queued-message cancellation");
  const snap = await fetch(`${origin}/api/snapshot`, {
    headers: { Cookie: cookie() },
  });
  const snapshot = await snap.json();
  assert.ok(snapshot.leads.some((l) => l.id === lead.id));
  assert.equal(snapshot.delivery, "log");
  console.log("PASS live snapshot reflects saved records");
  for (const path of [
    "/dashboard",
    "/leads",
    `/leads/${lead.id}`,
    "/campaigns",
    "/inbox",
    "/demos",
    "/knowledge-base",
    "/analytics",
    "/settings",
    "/settings/integrations",
  ]) {
    const r = await fetch(origin + path, { headers: { Cookie: cookie() } });
    assert.equal(r.status, 200, path);
  }
  console.log("PASS every protected screen renders");
  for (const path of [
    "/api/cron",
    "/demo/not-a-token",
    "/onboarding/not-a-token",
  ]) {
    const r = await fetch(origin + path);
    assert.ok([401, 404].includes(r.status), path);
  }
  console.log("PASS protected worker and invalid public-link rejection");
} finally {
  const all = await service.from("leads").select("id").eq("source", source);
  const cleanup = [
    ...new Set([...ids, ...(all.data || []).map((r) => r.id)]),
  ].filter((id) => /^[a-f0-9-]{36}$/.test(id));
  const auditedEntityIds = [];
  for (const table of [
    "campaign_leads",
    "tasks",
    "demos",
    "lead_contacts",
    "suppression_list",
  ]) {
    const rows = await service.from(table).select("id").in("lead_id", cleanup);
    for (const row of rows.data || []) auditedEntityIds.push(row.id);
  }
  const literal = cleanup.length
    ? cleanup.map((id) => `'${id}'`).join(",")
    : "'00000000-0000-0000-0000-000000000000'";
  const auditLiteral = auditedEntityIds.length
    ? auditedEntityIds.map((id) => `'${id}'`).join(",")
    : "'00000000-0000-0000-0000-000000000000'";
  let sql = "begin;";
  for (const table of [
    "messages",
    "conversations",
    "automation_jobs",
    "tasks",
    "demos",
    "lead_contacts",
    "campaign_leads",
    "suppression_list",
    "onboarding_records",
    "activities",
  ])
    sql += `delete from public.${table} where lead_id in (${literal});`;
  sql += `delete from public.leads where id in (${literal});delete from public.activities where entity_id in (${literal});`;
  if (campaignId)
    sql += `delete from public.campaigns where id='${campaignId}';delete from public.activities where entity_id='${campaignId}' or details->>'campaign_id'='${campaignId}';`;
  if (docId)
    sql += `delete from public.knowledge_base_versions where document_id='${docId}';delete from public.knowledge_base_documents where id='${docId}';delete from public.activities where entity_id='${docId}';`;
  sql += `delete from public.activities where entity_id in (${auditLiteral});commit;`;
  await management("/database/query", "POST", { query: sql });
  console.log("Temporary API-test records removed. No email sent.");
}
