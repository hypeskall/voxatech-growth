import { readFile, writeFile } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import { management, required } from "./shared.mjs";
const link = JSON.parse(
  await readFile(new URL("../.vercel/project.json", import.meta.url), "utf8"),
);
if (
  link.projectName !== "voxa-growth" ||
  link.projectId !== "prj_hNHB00Tsq2XqZ67nIFNTfamhHcrL"
)
  throw new Error("Refusing a different Vercel project");
if (required("EMAIL_DELIVERY_MODE") !== "log")
  throw new Error("EMAIL_DELIVERY_MODE must remain log");
const auth = JSON.parse(
  await readFile(
    `${process.env.APPDATA}/com.vercel.cli/Data/auth.json`,
    "utf8",
  ),
);
const path = `https://api.vercel.com/v10/projects/${link.projectId}/env?teamId=${link.orgId}`;
const envs = await fetch(path, {
  headers: { Authorization: `Bearer ${auth.token}` },
}).then(async (r) => {
  if (!r.ok) throw new Error(`Vercel env read HTTP ${r.status}`);
  return r.json();
});
const secret =
  process.env.AUTOPILOT_CRON_SECRET || randomBytes(32).toString("hex");
const existing = envs.envs.find(
  (e) => e.key === "AUTOPILOT_CRON_SECRET" && e.target.includes("production"),
);
if (existing && !process.env.AUTOPILOT_CRON_SECRET)
  throw new Error(
    "Existing scheduler secret: supply AUTOPILOT_CRON_SECRET to avoid rotating it accidentally.",
  );
if (!existing) {
  const r = await fetch(path, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${auth.token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      key: "AUTOPILOT_CRON_SECRET",
      value: secret,
      type: "sensitive",
      target: ["production"],
    }),
  });
  if (!r.ok) throw new Error(`Vercel scheduler secret HTTP ${r.status}`);
  await writeFile(
    new URL("../.env.autopilot.local", import.meta.url),
    `AUTOPILOT_CRON_SECRET=${secret}\n`,
  );
}
const literal = (s) => `'${s.replaceAll("'", "''")}'`;
const origin = "https://voxa-growth.vercel.app";
await management("/database/query", "POST", {
  query: `
begin;
create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;
do $setup$ declare id uuid; begin
 select s.id into id from vault.secrets s where name='voxa_growth_autopilot_secret';
 if id is null then perform vault.create_secret(${literal(secret)},'voxa_growth_autopilot_secret');
 else perform vault.update_secret(id,${literal(secret)},'voxa_growth_autopilot_secret'); end if;
end $setup$;
create or replace function private.wake_growth_autopilot() returns bigint language plpgsql set search_path='' as $wake$
begin
 if not exists(select 1 from public.autopilot_settings where enabled) then return null; end if;
 return net.http_get(url:='${origin}/api/autopilot/cron',headers:=jsonb_build_object('Authorization','Bearer '||(select decrypted_secret from vault.decrypted_secrets where name='voxa_growth_autopilot_secret')),timeout_milliseconds:=110000);
end $wake$;
revoke all on function private.wake_growth_autopilot() from public,anon,authenticated,service_role;
select cron.schedule('voxa-growth-autopilot','*/5 * * * *','select private.wake_growth_autopilot()');
commit;
`,
});
console.log(
  JSON.stringify({
    project: link.projectName,
    scheduler: "Supabase Cron",
    schedule: "*/5 * * * *",
    worker: `${origin}/api/autopilot/cron`,
    secretStored: "Vercel sensitive env + Supabase Vault",
    discovery: "remains paused until provider, rights and budget configured",
  }),
);
