import assert from "node:assert/strict";
import { createClient } from "@supabase/supabase-js";
import { createServerClient } from "@supabase/ssr";
import { required } from "./shared.mjs";

const origin = process.env.APP_URL || "http://localhost:3000";
if (!["localhost", "127.0.0.1", "[::1]"].includes(new URL(origin).hostname))
  throw new Error("AI smoke test refused: APP_URL must be local.");
if (process.env.EMAIL_DELIVERY_MODE === "live")
  throw new Error("AI smoke test refused: EMAIL_DELIVERY_MODE is live.");
required("GEMINI_API_KEY");
assert.equal(process.env.AI_PROVIDER, "google_gemini");
assert.equal(process.env.DEFAULT_AUTOMATION_MODEL, "gemini-3.8-flash");

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
const response = await fetch(`${origin}/api/actions`, {
  method: "POST",
  headers: {
    Origin: new URL(origin).origin,
    Cookie: [...jar].map(([name, value]) => `${name}=${value}`).join("; "),
    "Content-Type": "application/json",
  },
  body: JSON.stringify({ action: "ai_controlled_test", data: {} }),
});
const body = await response.json();
if (!response.ok)
  throw new Error(`AI smoke test failed (${response.status}): ${body.error}`);
assert.equal(body.message.status, "draft");
assert.equal(body.message.provider_message_id, null);
assert.equal(body.safeguards.delivery_mode, "log");
assert.equal(body.safeguards.campaign_created, false);
assert.equal(body.safeguards.delivery_attempted, false);
assert.equal(body.activities.length, 2);
for (const activity of body.activities) {
  assert.equal(activity.details.provider, "google_gemini");
  assert.match(activity.model, /^gemini-3\.8-flash/);
  assert.equal(activity.details.thinking_level, "low");
  assert.ok(activity.details.latency_ms > 0);
  assert.ok(activity.details.usage.total_tokens > 0);
  assert.ok(activity.details.estimated_cost_usd >= 0);
}
console.log(JSON.stringify(body, null, 2));
