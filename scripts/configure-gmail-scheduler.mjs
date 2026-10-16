import { management, required } from "./shared.mjs";
import { readFile } from "node:fs/promises";
const project = JSON.parse(
  await readFile(new URL("../.vercel/project.json", import.meta.url), "utf8"),
);
if (
  project.projectName !== "voxa-growth" ||
  project.projectId !== "prj_hNHB00Tsq2XqZ67nIFNTfamhHcrL"
)
  throw new Error("Refusing another project");
required("SUPABASE_ACCESS_TOKEN");
await management("/database/query", "POST", {
  query: `
begin;
do $check$ begin
 if not exists(select 1 from vault.secrets where name='voxa_growth_autopilot_secret') then raise exception 'Configure the existing Autopilot scheduler secret first'; end if;
end $check$;
create or replace function private.wake_growth_autopilot() returns bigint language plpgsql set search_path='' as $wake$
begin
 if not exists(select 1 from public.gmail_accounts where status in ('connected','paused'))
    and not exists(select 1 from public.gmail_autopilot_settings where enabled)
    and not exists(select 1 from public.autopilot_settings where enabled) then return null; end if;
 return net.http_get(url:='https://voxa-growth.vercel.app/api/autopilot/cron',headers:=jsonb_build_object('Authorization','Bearer '||(select decrypted_secret from vault.decrypted_secrets where name='voxa_growth_autopilot_secret')),timeout_milliseconds:=240000);
end $wake$;
revoke all on function private.wake_growth_autopilot() from public,anon,authenticated,service_role;
select cron.schedule('voxa-growth-autopilot','*/5 * * * *','select private.wake_growth_autopilot()');
commit;
`,
});
console.log(
  JSON.stringify({
    scheduler: "Supabase Cron",
    intervalMinutes: 5,
    inboxSync: "continues while mailboxes are connected",
    automaticDelivery: "requires owner Start and live mode; remains paused now",
  }),
);
