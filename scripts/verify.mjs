import { required, project, tables } from "./shared.mjs";
import { writeFile } from "node:fs/promises";
const { url } = project();
const anon = required("NEXT_PUBLIC_SUPABASE_ANON_KEY");
const service = required("SUPABASE_SERVICE_ROLE_KEY");
async function request(path, key) {
  const response = await fetch(`${url}${path}`, {
    headers: {
      apikey: key,
      ...(key.startsWith("eyJ") ? { Authorization: `Bearer ${key}` } : {}),
    },
    signal: AbortSignal.timeout(20000),
  });
  return {
    status: response.status,
    data: await response.json().catch(() => null),
  };
}
const report = { checkedAt: new Date().toISOString(), checks: [] };
for (const [name, path, key] of [
  ["public API credential", "/auth/v1/settings", anon],
  ["server API credential", "/auth/v1/admin/users?page=1&per_page=1", service],
  ["database REST connection", "/rest/v1/", service],
]) {
  const result = await request(path, key);
  report.checks.push({
    name,
    ok: result.status === 200,
    status: result.status,
  });
}
for (const table of tables) {
  const result = await request(`/rest/v1/${table}?select=id&limit=0`, service);
  report.checks.push({
    name: `table ${table}`,
    ok: result.status === 200,
    status: result.status,
  });
  const unauthenticated = await request(
    `/rest/v1/${table}?select=id&limit=1`,
    anon,
  );
  report.checks.push({
    name: `anonymous denied ${table}`,
    ok:
      [401, 403].includes(unauthenticated.status) ||
      (unauthenticated.status === 200 &&
        Array.isArray(unauthenticated.data) &&
        unauthenticated.data.length === 0),
    status: unauthenticated.status,
  });
}
await writeFile("verification.local.json", JSON.stringify(report, null, 2));
for (const check of report.checks)
  console.log(
    `${check.ok ? "PASS" : "FAIL"} ${check.name}: HTTP ${check.status}`,
  );
if (report.checks.some((check) => !check.ok)) process.exitCode = 1;
