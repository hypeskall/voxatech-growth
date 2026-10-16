import { management, project, required } from "./shared.mjs";
import assert from "node:assert/strict";
const rows = await management("/database/query", "POST", {
  query: `select c.relname,c.relrowsecurity,has_table_privilege('anon',c.oid,'select') anon_read,has_table_privilege('authenticated',c.oid,'select') user_read,has_table_privilege('service_role',c.oid,'select') server_read from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname in ('gmail_accounts','gmail_threads','gmail_delivery_attempts','gmail_autopilot_settings')`,
});
assert.equal(rows.length, 4);
assert.ok(
  rows.every(
    (row) =>
      row.relrowsecurity && !row.anon_read && !row.user_read && row.server_read,
  ),
);
const advisors = await management("/advisors/security");
const findings = (advisors.lints || []).filter((item) =>
  /gmail_/i.test(JSON.stringify(item)),
);
// RLS with no user policy is intentional: these tables have no anon or
// authenticated privileges. Only the trusted server can reach them.
assert.ok(!findings.some((item) => item.level === "ERROR"));
const stats = await management("/database/query", "POST", {
  query: `select (select count(*) from public.gmail_accounts)::int mailboxes,(select count(*) from public.gmail_autopilot_settings where enabled)::int enabled_organizations,(select count(*) from cron.job where jobname='voxa-growth-autopilot' and active)::int active_schedulers`,
});
const { url } = project();
for (const table of [
  "gmail_accounts",
  "gmail_delivery_attempts",
  "gmail_threads",
  "gmail_autopilot_settings",
]) {
  const response = await fetch(`${url}/rest/v1/${table}?select=*&limit=1`, {
    headers: {
      apikey: required("NEXT_PUBLIC_SUPABASE_ANON_KEY"),
      Authorization: `Bearer ${required("NEXT_PUBLIC_SUPABASE_ANON_KEY")}`,
    },
  });
  assert.ok([401, 403].includes(response.status));
}
console.log(
  JSON.stringify({
    credentialTablesProtected: true,
    anonymousRestAccessDenied: true,
    gmailSecurityAdvisors: findings.map((item) => ({
      name: item.name,
      level: item.level,
    })),
    state: stats[0],
  }),
);
