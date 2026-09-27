-- Make native Google Gemini the organization-wide AI provider and retain old provider rows for future adapters.
insert into public.settings(organization_id,key,value)
select id,'ai_provider','"google_gemini"'::jsonb from public.organizations
on conflict(organization_id,key) do update set value=excluded.value;

insert into public.settings(organization_id,key,value)
select id,'ai_models','{"default":"gemini-3.8-flash"}'::jsonb from public.organizations
on conflict(organization_id,key) do update set value=excluded.value;

insert into public.settings(organization_id,key,value)
select id,'costs','{"input_per_million":0.75,"output_per_million":3.75}'::jsonb from public.organizations
on conflict(organization_id,key) do update set value=excluded.value;

insert into public.integrations(organization_id,provider,enabled,public_config)
select id,'google_gemini',false,'{"health":"unverified","model":"gemini-3.8-flash"}'::jsonb
from public.organizations
on conflict(organization_id,provider) do update
set enabled=false,public_config=excluded.public_config,last_verified_at=null;

update public.integrations set enabled=false where provider='openai';
