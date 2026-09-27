import { management } from "./shared.mjs";
import { readFile } from "node:fs/promises";
const { userId } = JSON.parse(
  await readFile("../../work/admin-access.json", "utf8"),
);
if (!/^[a-f0-9-]{36}$/.test(userId))
  throw new Error("Invalid administrator id.");
await management("/database/query", "POST", {
  query: `begin;
insert into public.organizations(id,name,slug) values('90000000-0000-4000-8000-000000000099','RLS verification only','voxa-rls-transaction');
insert into public.leads(organization_id,company_name) values('90000000-0000-4000-8000-000000000099','RLS verification only');
set local role authenticated;
select set_config('request.jwt.claim.sub','${userId}',true);
do $$ begin
 if exists(select 1 from public.organizations where id='90000000-0000-4000-8000-000000000099') then raise exception 'Cross-tenant organization disclosure'; end if;
 if exists(select 1 from public.leads where organization_id='90000000-0000-4000-8000-000000000099') then raise exception 'Cross-tenant lead disclosure'; end if;
 if not exists(select 1 from public.organizations where slug='voxatech') then raise exception 'Own organization missing'; end if;
 begin
 insert into public.leads(organization_id,company_name) values('90000000-0000-4000-8000-000000000099','Forbidden');
 raise exception 'Cross-tenant insert permitted';
 exception when insufficient_privilege then null; end;
 begin
 update public.organization_members set role='admin' where user_id='${userId}';
 raise exception 'Membership edit permitted';
 exception when insufficient_privilege then null; end;
end $$;
rollback;`,
});
console.log(
  "PASS hosted RLS: own-organization read, cross-tenant read/write denial, membership edit denial. All verification data rolled back.",
);
