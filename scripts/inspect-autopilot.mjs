import { management } from "./shared.mjs";
import { readFile } from "node:fs/promises";
const sql = `select 'lead_sources' as section, jsonb_agg(t) as data from (select source,count(*) from public.leads group by source) t
union all select 'jobs',jsonb_agg(t) from (select kind,status,count(*) from public.automation_jobs group by kind,status) t
union all select 'campaigns',jsonb_agg(t) from (select status,count(*) from public.campaigns group by status) t
union all select 'settings',jsonb_agg(t) from (select key,value from public.settings where key in ('ai_models','costs','ai_provider')) t
union all select 'scheduler',jsonb_agg(t) from (select extname from pg_extension where extname in ('pg_cron','pg_net','supabase_vault')) t;
`;
console.log(
  JSON.stringify(
    await management("/database/query", "POST", { query: sql }),
    null,
    2,
  ),
);
const link = JSON.parse(
  await readFile(new URL("../.vercel/project.json", import.meta.url), "utf8"),
);
const auth = JSON.parse(
  await readFile(
    `${process.env.APPDATA}/com.vercel.cli/Data/auth.json`,
    "utf8",
  ),
);
const base = `https://api.vercel.com`;
for (const path of [
  `/v2/teams/${link.orgId}`,
  `/v9/projects/${link.projectId}?teamId=${link.orgId}`,
  `/v10/projects/${link.projectId}/env?teamId=${link.orgId}`,
]) {
  const r = await fetch(base + path, {
    headers: { Authorization: `Bearer ${auth.token}` },
  });
  if (!r.ok) {
    console.log({ path, status: r.status });
    continue;
  }
  const d = await r.json();
  if (d.envs)
    console.log({
      environment: d.envs.map((e) => ({
        key: e.key,
        target: e.target,
        type: e.type,
      })),
    });
  else if (d.billing) console.log({ team: d.name, plan: d.billing.plan });
  else
    console.log({
      project: d.name,
      id: d.id,
      domains: d.targets?.production?.alias,
      cron: d.crons,
      framework: d.framework,
    });
}
console.log({
  localDelivery: process.env.EMAIL_DELIVERY_MODE,
  braveConfigured: !!process.env.BRAVE_SEARCH_API_KEY,
});
