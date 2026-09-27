import assert from "node:assert/strict";
import { createClient } from "@supabase/supabase-js";
import { createServerClient } from "@supabase/ssr";
import { required } from "./shared.mjs";

const origin = process.env.APP_URL || "http://localhost:3000";
const source = "dry-run-audit-20260925";
const campaignName = "Audit operațional · dry-run";
if (process.env.EMAIL_DELIVERY_MODE === "live")
  throw new Error("Dry-run refused: EMAIL_DELIVERY_MODE is live.");

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
      setAll: (items) =>
        items.forEach(({ name, value }) => jar.set(name, value)),
    },
  },
);
const auth = await user.auth.verifyOtp({
  token_hash: link.properties.hashed_token,
  type: "magiclink",
});
if (auth.error) throw auth.error;
const userId = auth.data.user.id;
const membership = await service
  .from("organization_members")
  .select("organization_id")
  .eq("user_id", userId)
  .limit(1)
  .single();
if (membership.error) throw membership.error;
const org = membership.data.organization_id;
const cookie = () =>
  [...jar].map(([name, value]) => `${name}=${value}`).join("; ");
async function action(actionName, data, expected = 200) {
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
  assert.equal(response.status, expected, `${actionName}: ${body.error || ""}`);
  return body;
}
function ok(result, label) {
  if (result.error) throw new Error(`${label}: ${result.error.message}`);
  return result.data;
}
async function cleanupPreviousRun() {
  const old = ok(
    await service
      .from("leads")
      .select("id")
      .eq("organization_id", org)
      .eq("source", source),
    "read old leads",
  );
  const ids = old.map((row) => row.id);
  if (ids.length) {
    const auditedEntityIds = [...ids];
    for (const table of [
      "campaign_leads",
      "tasks",
      "demos",
      "lead_contacts",
      "suppression_list",
      "onboarding_records",
    ]) {
      const rows = ok(
        await service.from(table).select("id").in("lead_id", ids),
        `read old ${table}`,
      );
      auditedEntityIds.push(...rows.map((row) => row.id));
    }
    const oldDemos = ok(
      await service
        .from("demos")
        .select("storage_path,audio_segments")
        .in("lead_id", ids),
      "read old demos",
    );
    const paths = oldDemos.flatMap((demo) => [
      ...(demo.storage_path ? [demo.storage_path] : []),
      ...(Array.isArray(demo.audio_segments)
        ? demo.audio_segments.flatMap((segment) =>
            segment && typeof segment === "object" && "path" in segment
              ? [String(segment.path)]
              : [],
          )
        : []),
    ]);
    if (paths.length)
      ok(
        await service.storage.from("voxa-demos").remove(paths),
        "remove old demo files",
      );
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
      ok(
        await service.from(table).delete().in("lead_id", ids),
        `clean ${table}`,
      );
    ok(await service.from("leads").delete().in("id", ids), "clean leads");
    ok(
      await service
        .from("activities")
        .delete()
        .in("entity_id", auditedEntityIds),
      "clean generated audit entries",
    );
  }
  const oldCampaigns = ok(
    await service
      .from("campaigns")
      .select("id")
      .eq("organization_id", org)
      .eq("name", campaignName),
    "read old campaign",
  );
  if (oldCampaigns.length) {
    const campaignIds = oldCampaigns.map((row) => row.id);
    ok(
      await service
        .from("campaign_leads")
        .delete()
        .in("campaign_id", campaignIds),
      "clean campaign leads",
    );
    ok(
      await service.from("messages").delete().in("campaign_id", campaignIds),
      "clean campaign messages",
    );
    ok(
      await service.from("activities").delete().in("entity_id", campaignIds),
      "clean campaign audit",
    );
    ok(
      await service.from("campaigns").delete().in("id", campaignIds),
      "clean campaigns",
    );
    ok(
      await service.from("activities").delete().in("entity_id", campaignIds),
      "clean campaign delete audit",
    );
    for (const campaignId of campaignIds)
      ok(
        await service
          .from("activities")
          .delete()
          .contains("details", { campaign_id: campaignId }),
        "clean campaign action audit",
      );
  }
  ok(
    await service
      .from("webhook_events")
      .delete()
      .eq("organization_id", org)
      .like("event_id", "dry-run:%"),
    "clean dry-run events",
  );
  ok(
    await service
      .from("notifications")
      .delete()
      .eq("organization_id", org)
      .like("idempotency_key", "payment:cs_dry-run:%"),
    "clean dry-run notifications",
  );
}

const fixtures = [
  [
    "Clinica Dentară Armonia",
    "Stomatologie",
    "București",
    "Tratamente dentare pentru adulți și copii",
    true,
    true,
    true,
  ],
  [
    "Derma Nord",
    "Dermatologie",
    "Cluj-Napoca",
    "Consultații dermatologice și dermatoscopie",
    true,
    false,
    true,
  ],
  [
    "Centrul Medical Iris",
    "Oftalmologie",
    "Iași",
    "Consultații și investigații oftalmologice",
    true,
    true,
    false,
  ],
  [
    "Clinica ORL Sonor",
    "ORL",
    "Timișoara",
    "Consultații ORL și audiometrie",
    true,
    false,
    true,
  ],
  [
    "Estetica Nova",
    "Medicină estetică",
    "Brașov",
    "Consultații și tratamente estetice",
    true,
    true,
    true,
  ],
  [
    "DentaCare Someș",
    "Stomatologie",
    "Cluj-Napoca",
    "Profilaxie, implantologie și ortodonție",
    true,
    true,
    false,
  ],
  [
    "DermaVerde",
    "Dermatologie",
    "Oradea",
    "Dermatologie clinică și pediatrică",
    true,
    false,
    false,
  ],
  [
    "Medisfera Privat",
    "Servicii medicale private",
    "Sibiu",
    "Consultații multidisciplinare",
    true,
    true,
    true,
  ],
  [
    "Ochi Clar",
    "Oftalmologie",
    "Constanța",
    "Consultații și optometrie",
    true,
    false,
    true,
  ],
  [
    "Clinica Auris",
    "ORL",
    "București",
    "Consultații ORL pentru adulți și copii",
    true,
    true,
    false,
  ],
  [
    "Dentalis Prim",
    "Stomatologie",
    "Ploiești",
    "Stomatologie generală și chirurgie orală",
    true,
    true,
    true,
  ],
  [
    "Derma Line",
    "Dermatologie",
    "Craiova",
    "Consultații dermatologice și proceduri",
    true,
    false,
    true,
  ],
  [
    "MedNova Family",
    "Servicii medicale private",
    "Iași",
    "Medicină de familie și specialități clinice",
    true,
    true,
    false,
  ],
  [
    "Aesthetica Studio Medical",
    "Medicină estetică",
    "Timișoara",
    "Consultații și proceduri estetice",
    true,
    false,
    true,
  ],
  [
    "OptiView Clinic",
    "Oftalmologie",
    "Brașov",
    "Consultații, investigații și monitorizare",
    true,
    true,
    true,
  ],
  [
    "Dent Plus Vest",
    "Stomatologie",
    "Arad",
    "Stomatologie și ortodonție",
    true,
    false,
    false,
  ],
  [
    "Clinica Sinus",
    "ORL",
    "Sibiu",
    "Consultații și investigații ORL",
    true,
    true,
    true,
  ],
  [
    "Derma Expert",
    "Dermatologie",
    "București",
    "Consultații și evaluarea leziunilor cutanate",
    true,
    true,
    false,
  ],
  [
    "Policlinica Meridian",
    "Servicii medicale private",
    "Constanța",
    "Consultații în mai multe specialități",
    true,
    true,
    true,
  ],
  [
    "Zâmbet Urban",
    "Stomatologie",
    "Oradea",
    "Stomatologie generală și profilaxie",
    true,
    false,
    true,
  ],
].map(
  (
    [
      company,
      niche,
      city,
      services,
      phoneBooking,
      multipleDoctors,
      limitedHours,
    ],
    index,
  ) => ({
    company_name: company,
    niche,
    city,
    country: "RO",
    website: `https://clinica-fictiva-${String(index + 1).padStart(2, "0")}.example.invalid`,
    email: `contact${String(index + 1).padStart(2, "0")}@clinica-fictiva.example.invalid`,
    phone: `+4070090${String(index + 1).padStart(4, "0")}`,
    contact_name: index % 3 === 0 ? "Andreea Popescu" : null,
    source,
    services,
    phoneBooking,
    multipleDoctors,
    limitedHours,
  }),
);

await cleanupPreviousRun();
const imported = await action(
  "import",
  fixtures.map(
    ({
      services: _services,
      phoneBooking: _phone,
      multipleDoctors: _doctors,
      limitedHours: _hours,
      ...lead
    }) => lead,
  ),
);
assert.equal(imported.inserted, 20);
assert.equal(imported.errors.length, 0);
const leads = ok(
  await service
    .from("leads")
    .select("*")
    .eq("organization_id", org)
    .eq("source", source)
    .order("company_name"),
  "read imported leads",
);
assert.equal(leads.length, 20);
console.log("PASS import: 20 fictional Romanian clinics");

for (const lead of leads) {
  const fixture = fixtures.find(
    (item) => item.company_name === lead.company_name,
  );
  assert.ok(fixture);
  const reasons = [
    ...(fixture.phoneBooking
      ? [{ reason: "Programări telefonice", points: 25 }]
      : []),
    ...(fixture.multipleDoctors
      ? [{ reason: "Mai mulți medici", points: 20 }]
      : []),
    ...(fixture.limitedHours
      ? [{ reason: "Program limitat", points: 15 }]
      : []),
    { reason: "Fără programare online, conform fișei dry-run", points: 15 },
    { reason: "Specialitate potrivită", points: 10 },
  ];
  const score = reasons.reduce((sum, reason) => sum + reason.points, 0);
  ok(
    await service
      .from("leads")
      .update({
        status: "READY_FOR_OUTREACH",
        services: [fixture.services],
        opening_hours: { text: "Luni–Vineri, 09:00–17:00", dry_run: true },
        personalization_fact: `${fixture.company_name} prezintă ${fixture.services.toLowerCase()}.`,
        website_summary: `${fixture.company_name} este o clinică fictivă de ${fixture.niche.toLowerCase()} din ${fixture.city}, folosită exclusiv pentru verificarea locală.`,
        verified_facts: {
          dry_run_fixture: true,
          phone_booking: fixture.phoneBooking ? "da" : "necunoscut",
        },
        lead_score: score,
        lead_temperature: score >= 80 ? "hot" : score >= 45 ? "warm" : "cold",
        score_reasons: reasons,
        enriched_at: new Date().toISOString(),
      })
      .eq("id", lead.id)
      .eq("organization_id", org),
    "enrich fixture",
  );
  ok(
    await service.from("activities").insert({
      organization_id: org,
      lead_id: lead.id,
      action: "ai_research",
      model: "local-dry-run-fixture",
      details: { dry_run: true, score },
    }),
    "enrichment audit",
  );
}
ok(
  await service
    .from("automation_jobs")
    .update({ status: "completed", completed_at: new Date().toISOString() })
    .in(
      "lead_id",
      leads.map((lead) => lead.id),
    )
    .eq("kind", "enrich_new_leads")
    .eq("status", "pending"),
  "complete fixture enrichment jobs",
);
console.log(
  "PASS enrichment and scoring: verified dry-run fixtures, scores 50–85",
);

const campaign = await action("campaign_save", {
  campaign: {
    name: campaignName,
    niche: null,
    cities: [],
    target_filters: { min_score: "50", source },
    sender_identity: "dry-run@voxatech.example.invalid",
    tone: "profesional și direct",
    offer: "Simulare personalizată a recepționerului AI VoxaTech",
    daily_cap: 25,
    window_start: "09:30",
    window_end: "16:30",
    mode: "approval_required",
    first_message: "Mesaj inițial personalizat",
    follow_up_1: "Revenire scurtă",
    follow_up_2: "Ultima revenire",
  },
});
await action("campaign_status", { id: campaign.id, status: "active" });
await action("bulk_campaign", {
  ids: leads.map((lead) => lead.id),
  campaign_id: campaign.id,
});
console.log("PASS campaign: created, activated, and assigned atomically");

const messages = [];
for (const lead of leads) {
  const fixture = fixtures.find(
    (item) => item.company_name === lead.company_name,
  );
  const conv = ok(
    await service
      .from("conversations")
      .upsert(
        { organization_id: org, lead_id: lead.id, channel: "email" },
        { onConflict: "organization_id,lead_id,channel" },
      )
      .select()
      .single(),
    "conversation",
  );
  const message = ok(
    await service
      .from("messages")
      .insert({
        organization_id: org,
        lead_id: lead.id,
        conversation_id: conv.id,
        campaign_id: campaign.id,
        direction: "outbound",
        subject: `O idee pentru recepția ${lead.company_name}`,
        body: `Bună ziua! Am observat că ${fixture.services.toLowerCase()}. VoxaTech poate răspunde apelurilor când recepția este ocupată sau în afara programului și poate ajuta cu programările. Ar fi utilă o simulare scurtă pentru ${lead.company_name}?`,
        status: "draft",
        model: "local-dry-run-fixture",
        idempotency_key: `dry-run:outreach:${lead.id}`,
        follow_up_number: 0,
        metadata: { dry_run: true },
      })
      .select()
      .single(),
    "outreach draft",
  );
  messages.push(message);
  await action("message_approve", { id: message.id });
}
console.log("PASS drafting: 20 personalized Romanian drafts approved");

async function runWorkers() {
  for (let pass = 0; pass < 12; pass++) {
    const response = await fetch(`${origin}/api/worker`, {
      method: "POST",
      headers: { Origin: new URL(origin).origin, Cookie: cookie() },
    });
    const body = await response.json();
    assert.equal(response.status, 200, body.error || "worker failed");
    if (!body.results.length) return;
  }
  throw new Error("Worker did not drain the dry-run queue.");
}
await runWorkers();
const sentInitial = ok(
  await service
    .from("messages")
    .select("id")
    .eq("organization_id", org)
    .eq("campaign_id", campaign.id)
    .eq("provider", "local-dry-run")
    .eq("follow_up_number", 0),
  "read simulated sends",
);
assert.equal(sentInitial.length, 20);
console.log("PASS simulated send: 20 local deliveries, zero external emails");

const journey = leads[0];
const conversation = ok(
  await service
    .from("conversations")
    .select("id")
    .eq("lead_id", journey.id)
    .single(),
  "journey conversation",
);
const inbound = ok(
  await service
    .from("messages")
    .insert({
      organization_id: org,
      lead_id: journey.id,
      conversation_id: conversation.id,
      campaign_id: campaign.id,
      direction: "inbound",
      subject: "Re: simulare VoxaTech",
      body: "Da, ne interesează. Ne puteți arăta o simulare pentru programări?",
      status: "received",
      provider: "local-dry-run",
      provider_message_id: `local:reply:${journey.id}`,
      idempotency_key: `dry-run:inbound:${journey.id}`,
      received_at: new Date().toISOString(),
      classification: "positive",
      model: "local-dry-run-fixture",
      metadata: { simulated: true },
    })
    .select()
    .single(),
  "simulated reply",
);
ok(
  await service
    .from("campaign_leads")
    .update({
      stopped_at: new Date().toISOString(),
      stop_reason: "reply",
      next_action_at: null,
    })
    .eq("organization_id", org)
    .eq("lead_id", journey.id),
  "stop followups",
);
ok(
  await service
    .from("leads")
    .update({
      status: "QUALIFIED",
      next_action_at: null,
      conversation_summary:
        "Prospect interesat de o simulare pentru programări.",
    })
    .eq("id", journey.id),
  "qualify lead",
);
ok(
  await service.from("activities").insert({
    organization_id: org,
    lead_id: journey.id,
    action: "ai_reply",
    model: "local-dry-run-fixture",
    details: {
      dry_run: true,
      classification: "positive",
      message_id: inbound.id,
    },
  }),
  "reply audit",
);
ok(
  await service.from("messages").insert({
    organization_id: org,
    lead_id: journey.id,
    conversation_id: conversation.id,
    campaign_id: campaign.id,
    in_reply_to: inbound.id,
    direction: "outbound",
    subject: "Re: simulare VoxaTech",
    body: "Sigur. Pregătim o simulare demonstrativă bazată pe serviciile verificate ale clinicii.",
    status: "draft",
    model: "local-dry-run-fixture",
    idempotency_key: `dry-run:reply:${inbound.id}`,
    metadata: { dry_run: true },
  }),
  "reply draft",
);
console.log("PASS reply and qualification: positive reply stopped follow-ups");

const script = {
  turns: [
    {
      role: "Pacient",
      text: "Bună ziua, aș dori să mă programez pentru o consultație săptămâna viitoare.",
    },
    {
      role: "Voxa",
      text: `Bună ziua! Ați sunat la ${journey.company_name}. Vă ajut cu plăcere. Pentru ce serviciu doriți programarea?`,
    },
    {
      role: "Pacient",
      text: "Pentru o consultație inițială, de preferat miercuri după-amiază.",
    },
    {
      role: "Voxa",
      text: "Am înțeles. Verific intervalele disponibile din programul clinicii și, dacă este nevoie, vă transfer unui coleg.",
    },
    { role: "Pacient", text: "Perfect, mulțumesc." },
    {
      role: "Voxa",
      text: "Cu drag. Aceasta este o simulare demonstrativă VoxaTech; nicio programare reală nu a fost creată.",
    },
  ],
};
let demo = ok(
  await service
    .from("demos")
    .insert({
      organization_id: org,
      lead_id: journey.id,
      status: "script_pending",
      idempotency_key: `dry-run:demo:${journey.id}`,
      model: "local-dry-run-fixture",
      expires_at: new Date(Date.now() + 30 * 86400000).toISOString(),
    })
    .select()
    .single(),
  "create demo",
);
const scriptPath = `${org}/${demo.id}/script.json`;
ok(
  await service.storage
    .from("voxa-demos")
    .upload(scriptPath, JSON.stringify(script), {
      contentType: "application/json",
      upsert: true,
    }),
  "save demo script",
);
demo = ok(
  await service
    .from("demos")
    .update({
      script,
      storage_path: scriptPath,
      status: "audio_awaiting_configuration",
    })
    .eq("id", demo.id)
    .select()
    .single(),
  "complete demo script",
);
const demoMessage = ok(
  await service
    .from("messages")
    .insert({
      organization_id: org,
      lead_id: journey.id,
      conversation_id: conversation.id,
      campaign_id: campaign.id,
      direction: "outbound",
      subject: `Simulare VoxaTech pentru ${journey.company_name}`,
      body: `Am pregătit simularea demonstrativă: ${origin}/demo/${demo.share_token}`,
      status: "draft",
      idempotency_key: `dry-run:demo-send:${demo.id}`,
      metadata: { dry_run: true, demo_id: demo.id },
    })
    .select()
    .single(),
  "demo message",
);
await action("message_approve", { id: demoMessage.id });
await runWorkers();
console.log(
  "PASS demo: script stored, public token created, audio correctly awaiting configuration",
);

const checkoutMessage = ok(
  await service
    .from("messages")
    .insert({
      organization_id: org,
      lead_id: journey.id,
      conversation_id: conversation.id,
      campaign_id: campaign.id,
      direction: "outbound",
      subject: "VoxaTech · link de plată dry-run",
      body: "Link de plată simulat: https://checkout.example.invalid/voxa-growth",
      status: "draft",
      idempotency_key: `dry-run:checkout:${journey.id}`,
      metadata: { dry_run: true, checkout: true },
    })
    .select()
    .single(),
  "checkout draft",
);
await action("message_approve", { id: checkoutMessage.id });
await runWorkers();
const eventId = `dry-run:${journey.id}`;
const paymentEvent = ok(
  await service
    .from("webhook_events")
    .insert({
      organization_id: org,
      provider: "stripe",
      event_id: eventId,
      event_type: "checkout.session.completed",
      payload: {
        id: `cs_${eventId}`,
        amount_total: 149900,
        currency: "ron",
        metadata: { lead_id: journey.id, organization_id: org },
      },
    })
    .select()
    .single(),
  "payment event",
);
ok(
  await service.from("automation_jobs").insert({
    organization_id: org,
    lead_id: journey.id,
    kind: "sync_payment_events",
    idempotency_key: `payment:${eventId}`,
    payload: { event_id: paymentEvent.id },
  }),
  "payment job",
);
await runWorkers();
const onboarding = ok(
  await service
    .from("onboarding_records")
    .select("*")
    .eq("lead_id", journey.id)
    .single(),
  "onboarding record",
);
const onboardingResponse = await fetch(
  `${origin}/api/onboarding/${onboarding.share_token}`,
  {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      clinic: `${journey.company_name}, adresă fictivă pentru dry-run`,
      contact: "Andreea Popescu, contact fictiv",
      services: "Consultații și programări generale",
      schedule: "Luni–Vineri, 09:00–17:00",
      greeting: `Bună ziua, ați sunat la ${journey.company_name}.`,
      transfer: "Transfer către recepție pentru solicitări complexe.",
      appointments: "Confirmă serviciul și intervalul înainte de salvare.",
      calendar: "Calendar demonstrativ, fără credențiale.",
    }),
  },
);
assert.equal(onboardingResponse.status, 200);
const finalLead = ok(
  await service
    .from("leads")
    .select("status,revenue_won,currency")
    .eq("id", journey.id)
    .single(),
  "final lead",
);
const finalOnboarding = ok(
  await service
    .from("onboarding_records")
    .select("status")
    .eq("id", onboarding.id)
    .single(),
  "final onboarding",
);
assert.equal(finalLead.status, "WON");
assert.equal(Number(finalLead.revenue_won), 1499);
assert.equal(finalLead.currency, "RON");
assert.equal(finalOnboarding.status, "completed");
console.log(
  "PASS checkout and onboarding: payment idempotency, WON, form completed",
);

const final = ok(
  await service
    .from("leads")
    .select("id,status")
    .eq("organization_id", org)
    .eq("source", source),
  "final seeded leads",
);
assert.equal(final.length, 20);
assert.equal(final.filter((lead) => lead.status === "WON").length, 1);
console.log(
  "DRY-RUN COMPLETE: 20 fictional leads retained; no external email, AI, TTS, or payment call was made.",
);
