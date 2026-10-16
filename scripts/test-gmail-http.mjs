import assert from "node:assert/strict";
import { createClient } from "@supabase/supabase-js";
import { createServerClient } from "@supabase/ssr";
import { required } from "./shared.mjs";
const origin = process.argv[2] || "http://localhost:3014";
assert.ok(
  ["http://localhost:3014", "https://voxa-growth.vercel.app"].includes(origin),
  "Only the Voxa preview or production origin is allowed",
);
const service = createClient(
  required("NEXT_PUBLIC_SUPABASE_URL"),
  required("SUPABASE_SERVICE_ROLE_KEY"),
  { auth: { persistSession: false, autoRefreshToken: false } },
);
const link = await service.auth.admin.generateLink({
  type: "magiclink",
  email: required("VOXA_ADMIN_EMAIL"),
});
if (link.error) throw new Error("Test authorization failed");
const jar = new Map();
const client = createServerClient(
  required("NEXT_PUBLIC_SUPABASE_URL"),
  required("NEXT_PUBLIC_SUPABASE_ANON_KEY"),
  {
    cookies: {
      getAll: () => [...jar].map(([name, value]) => ({ name, value })),
      setAll: (items) =>
        items.forEach((item) => jar.set(item.name, item.value)),
    },
  },
);
const authenticated = await client.auth.verifyOtp({
  token_hash: link.data.properties.hashed_token,
  type: "magiclink",
});
if (authenticated.error) throw new Error("Test sign-in failed");
const cookie = [...jar].map(([name, value]) => `${name}=${value}`).join("; ");
async function post(
  path,
  body,
  { signed = true, allowedOrigin = origin } = {},
) {
  return fetch(`${origin}${path}`, {
    method: "POST",
    headers: {
      Origin: allowedOrigin,
      "Content-Type": "application/json",
      ...(signed ? { Cookie: cookie } : {}),
    },
    body: JSON.stringify(body),
  });
}
const snapshot = await fetch(`${origin}/api/snapshot`, {
  headers: { Cookie: cookie },
}).then(async (response) => {
  assert.equal(response.status, 200);
  return response.json();
});
assert.ok(Array.isArray(snapshot.gmail_accounts));
assert.ok(
  !snapshot.gmail_accounts.some(
    (account) =>
      "encrypted_refresh_token" in account || "google_subject" in account,
  ),
);
for (const path of [
  "/api/gmail/connect",
  "/api/gmail/accounts",
  "/api/gmail/autopilot",
]) {
  assert.equal(
    (await post(path, { action: "start" }, { signed: false })).status,
    403,
  );
  assert.equal(
    (
      await post(
        path,
        { action: "start" },
        { allowedOrigin: "https://attacker.example" },
      )
    ).status,
    403,
  );
}
assert.equal(
  (await post("/api/gmail/autopilot", { action: "start", confirmed: false }))
    .status,
  400,
);
assert.equal(
  (
    await post("/api/gmail/accounts", {
      action: "limit",
      id: crypto.randomUUID(),
      daily_cap: 11,
    })
  ).status,
  400,
);
assert.equal(
  (
    await post("/api/gmail/accounts", {
      action: "disconnect",
      id: crypto.randomUUID(),
    })
  ).status,
  400,
);
const forged = await fetch(
  `${origin}/api/gmail/callback?state=forged&code=not-a-code`,
  { headers: { Cookie: cookie }, redirect: "manual" },
);
assert.equal(forged.status, 307);
assert.ok(forged.headers.get("location").includes("gmail=failed"));
assert.equal(
  (
    await fetch(`${origin}/api/autopilot/cron`, {
      headers: { Authorization: "Bearer invalid" },
    })
  ).status,
  401,
);
const connect = await post("/api/gmail/connect", {});
if (!snapshot.providers.gmail) assert.equal(connect.status, 400);
else {
  assert.equal(connect.status, 200);
  const body = await connect.json();
  const url = new URL(body.url);
  assert.equal(url.hostname, "accounts.google.com");
  assert.ok(url.searchParams.get("scope").includes("gmail.readonly"));
  assert.equal(url.searchParams.get("code_challenge_method"), "S256");
}
if (origin === "http://localhost:3014") {
  const id = crypto.randomUUID();
  const fixture = await service.from("leads").insert({
    id,
    organization_id: snapshot.user.org,
    company_name: `Gmail HTTP fixture ${id}`,
    email: `fixture-${id}@example.invalid`,
    source: "gmail_integration_test",
    status: "HUMAN_REQUIRED",
  });
  assert.equal(fixture.error, null);
  try {
    const messages = ["sending", "failed"].map((status) => ({
      id: crypto.randomUUID(),
      organization_id: snapshot.user.org,
      lead_id: id,
      direction: "outbound",
      body: "Fixture — no delivery",
      status,
      metadata: { human_approved: true, integration_test: true },
      reserved_at: status === "sending" ? new Date().toISOString() : null,
      idempotency_key: `http-fixture:${crypto.randomUUID()}`,
    }));
    const inserted = await service.from("messages").insert(messages);
    assert.equal(inserted.error, null);
    for (const message of messages) {
      for (const action of [
        "message_save",
        "message_approve",
        "message_reject",
      ]) {
        const response = await post("/api/actions", {
          action,
          data: {
            id: message.id,
            body: "Should not replace a sending or failed message",
          },
        });
        assert.equal(
          response.status,
          400,
          `${action} must reject ${message.status}`,
        );
      }
      const current = await service
        .from("messages")
        .select("body,status")
        .eq("id", message.id)
        .single();
      assert.equal(current.error, null);
      assert.equal(current.data.status, message.status);
      assert.equal(current.data.body, message.body);
    }
    assert.equal(
      (
        await post("/api/actions", {
          action: "message_reply",
          data: {
            lead_id: id,
            inbound_id: crypto.randomUUID(),
            body: "Reply fixture",
          },
        })
      ).status,
      400,
    );
  } finally {
    const entityIds = [id];
    for (const table of ["messages", "conversations"]) {
      const records = await service
        .from(table)
        .select("id")
        .eq("organization_id", snapshot.user.org)
        .eq("lead_id", id);
      assert.equal(records.error, null);
      entityIds.push(...records.data.map((row) => row.id));
    }
    for (const table of [
      "automation_jobs",
      "messages",
      "conversations",
      "activities",
    ]) {
      const child = await service
        .from(table)
        .delete()
        .eq("organization_id", snapshot.user.org)
        .eq("lead_id", id);
      assert.equal(
        child.error,
        null,
        `Temporary ${table} fixture must be removed`,
      );
    }
    const removed = await service
      .from("leads")
      .delete()
      .eq("organization_id", snapshot.user.org)
      .eq("id", id)
      .eq("source", "gmail_integration_test");
    assert.equal(removed.error, null, "Temporary fixture must be removed");
    const audit = await service
      .from("activities")
      .delete()
      .eq("organization_id", snapshot.user.org)
      .in("entity_id", entityIds);
    assert.equal(audit.error, null, "Temporary fixture audit must be removed");
  }
}
const after = await fetch(`${origin}/api/snapshot`, {
  headers: { Cookie: cookie },
}).then((response) => response.json());
assert.equal(after.gmail_autopilot_enabled, snapshot.gmail_autopilot_enabled);
assert.equal(after.gmail_accounts.length, snapshot.gmail_accounts.length);
assert.equal(after.messages.length, snapshot.messages.length);
console.log(
  JSON.stringify({
    authenticatedSnapshot: true,
    credentialFieldsExcluded: true,
    unauthenticatedAndCrossOriginDenied: true,
    forgedOAuthDenied: true,
    capAboveTenDenied: true,
    startRequiresConfirmation: true,
    unknownAccountDenied: true,
    unauthorizedSchedulerDenied: true,
    sendingAndFailedMessagesProtected: origin === "http://localhost:3014",
    noEmailSent: true,
    noMailboxOrCampaignActivated: true,
  }),
);
