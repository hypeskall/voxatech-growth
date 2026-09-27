-- Optional LOCAL development data only. Never part of hosted migrations.
-- Run: SET voxa.environment = 'local'; then execute this file in a local database.
do $$ begin
 if coalesce(current_setting('voxa.environment',true),'')<>'local' then
  raise exception 'This seed is for local development only';
 end if;
 insert into public.leads(organization_id,company_name,city,niche,email,source)
 values('10000000-0000-4000-8000-000000000001','Clinică exemplu locală','București','Stomatologie','local-demo@example.invalid','local_fixture')
 on conflict do nothing;
end $$;
