-- Draft-only prospect discovery. Reuses automation_jobs and finish_automation_job.
alter table public.automation_jobs drop constraint automation_jobs_kind_check;
alter table public.automation_jobs add constraint automation_jobs_kind_check check(kind in
 ('enrich_new_leads','create_outreach_drafts','send_due_messages','process_follow_ups','process_inbound_replies','generate_requested_demos','notify_human_required','sync_payment_events','daily_summary','autopilot_discover','autopilot_research','autopilot_draft'));

create function private.prospect_phone(value text) returns text language sql immutable set search_path='' as $$
 select case when p ~ '^0[0-9]{9}$' then '+40'||substr(p,2) when p like '00%' then '+'||substr(p,3) when p ~ '^40[0-9]{9}$' then '+'||p else nullif(p,'') end
 from (select regexp_replace(coalesce(value,''),'[^0-9+]','','g') p) s;
$$;
create index leads_prospect_phone_idx on public.leads(organization_id,private.prospect_phone(phone));
create index lead_contacts_prospect_email_idx on public.lead_contacts(organization_id,lower(trim(email)));
create index lead_contacts_prospect_phone_idx on public.lead_contacts(organization_id,private.prospect_phone(phone));

create table public.autopilot_settings (
 organization_id uuid primary key references public.organizations(id),
 enabled boolean not null default false, city text not null default 'București' check(length(city) between 2 and 100),
 specialty text not null default 'Stomatologie' check(length(specialty) between 2 and 100), country text not null default 'RO' check(country='RO'),
 require_website boolean not null default true, require_email boolean not null default true, require_phone boolean not null default false,
 daily_target integer not null default 10 check(daily_target between 1 and 10),
 daily_api_limit integer not null default 5 check(daily_api_limit between 1 and 10),
 daily_ai_budget_usd numeric(12,6) not null default 0 check(daily_ai_budget_usd between 0 and 100),
 provider_request_cost_usd numeric(12,6) not null default 0.005 check(provider_request_cost_usd between 0.001 and 1),
 storage_rights_confirmed boolean not null default false,
 min_fit_score integer not null default 60 check(min_fit_score between 0 and 100),
 next_api_at timestamptz, last_success_at timestamptz, last_error text,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
insert into public.autopilot_settings(organization_id) select id from public.organizations;

create table public.autopilot_runs (
 id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id),
 day date not null, targeting jsonb not null, status text not null default 'running' check(status in ('running','completed','limited','failed')),
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 unique(organization_id,day), unique(organization_id,id)
);
create table public.autopilot_usage (
 organization_id uuid not null references public.organizations(id), day date not null,
 qualified integer not null default 0 check(qualified>=0), api_requests integer not null default 0 check(api_requests>=0),
 ai_requests integer not null default 0 check(ai_requests>=0), ai_cost_usd numeric(12,6) not null default 0 check(ai_cost_usd>=0),
 provider_cost_usd numeric(12,6) not null default 0 check(provider_cost_usd>=0),
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(), primary key(organization_id,day)
);
create table public.autopilot_candidates (
 id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id), run_id uuid not null,
 source_url text not null, domain text not null, provider text not null default 'brave_search', provider_title text not null,
 discovered_at timestamptz not null default now(), researched_at timestamptz,
 state text not null default 'discovered' check(state in ('discovered','duplicate','rejected','qualified','drafted','failed','limited')),
 lead_id uuid, research jsonb, fit_score integer check(fit_score between 0 and 100), confidence integer check(confidence between 0 and 100),
 last_error text, created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 unique(organization_id,run_id,domain), unique(organization_id,id),
 foreign key(organization_id,run_id) references public.autopilot_runs(organization_id,id),
 foreign key(organization_id,lead_id) references public.leads(organization_id,id)
);
create index autopilot_candidates_run_idx on public.autopilot_candidates(organization_id,run_id,state);
create index autopilot_jobs_due_idx on public.automation_jobs(next_action_at) where kind like 'autopilot_%' and status in ('pending','running');

-- Tenant readers; only trusted server writes. Settings changes require owner/admin in HTTP API.
do $$ declare t text; begin
 foreach t in array array['autopilot_settings','autopilot_runs','autopilot_usage','autopilot_candidates'] loop
  execute format('alter table public.%I enable row level security',t);
  execute format('revoke all on public.%I from public,anon,authenticated',t);
  execute format('grant select on public.%I to authenticated',t);
  execute format('grant all on public.%I to service_role',t);
  execute format('create policy tenant_read on public.%I for select to authenticated using(private.member_of(organization_id))',t);
  execute format('create trigger touch_updated_at before update on public.%I for each row execute function private.touch_updated_at()',t);
 end loop;
end $$;

create function public.schedule_autopilot(target_org uuid default null) returns void language plpgsql set search_path='' as $$
declare cfg public.autopilot_settings; run public.autopilot_runs; usage public.autopilot_usage; d date:=(now() at time zone 'Europe/Bucharest')::date;
begin
 perform public.refresh_autopilot_runs(target_org);
 for cfg in select * from public.autopilot_settings where enabled and daily_ai_budget_usd>0 and storage_rights_confirmed and (target_org is null or organization_id=target_org) for update skip locked loop
  insert into public.autopilot_usage(organization_id,day) values(cfg.organization_id,d) on conflict do nothing;
  select * into usage from public.autopilot_usage where organization_id=cfg.organization_id and day=d;
  if usage.qualified>=cfg.daily_target or usage.api_requests>=cfg.daily_api_limit or usage.ai_cost_usd>=cfg.daily_ai_budget_usd then continue; end if;
  insert into public.autopilot_runs(organization_id,day,targeting) values(cfg.organization_id,d,to_jsonb(cfg)-'last_error') on conflict do nothing;
  select * into run from public.autopilot_runs where organization_id=cfg.organization_id and day=d;
  -- Finish research/drafts before searching again. One search page at a time.
  if exists(select 1 from public.automation_jobs where organization_id=cfg.organization_id and kind like 'autopilot_%' and status in ('running','pending') and next_action_at<=now()+interval '1 day') then continue; end if;
  insert into public.automation_jobs(organization_id,kind,idempotency_key,payload,max_attempts)
  values(cfg.organization_id,'autopilot_discover','autopilot:search:'||d||':'||usage.api_requests,jsonb_build_object('run_id',run.id,'offset',usage.api_requests),3) on conflict do nothing;
 end loop;
end $$;

-- A worker claims only this subsystem; pause prevents new claims including retry jobs.
create function public.claim_autopilot_job(target_org uuid default null) returns setof public.automation_jobs language plpgsql set search_path='' as $$
begin
 update public.automation_jobs set status='failed',last_error='Lease expired after final attempt',locked_until=null,lock_token=null
 where kind like 'autopilot_%' and status='running' and locked_until<now() and attempts>=max_attempts and (target_org is null or organization_id=target_org);
 return query with due as (
  select j.id from public.automation_jobs j join public.autopilot_settings s on s.organization_id=j.organization_id
  where s.enabled and j.kind like 'autopilot_%' and (target_org is null or j.organization_id=target_org)
  and ((j.status='pending' and j.next_action_at<=now()) or (j.status='running' and j.locked_until<now())) and j.attempts<j.max_attempts
  order by case j.kind when 'autopilot_draft' then 0 when 'autopilot_research' then 1 else 2 end,j.next_action_at,j.id for update of j skip locked limit 1
 ) update public.automation_jobs j set status='running',attempts=attempts+1,locked_until=now()+interval '5 minutes',lock_token=gen_random_uuid() from due where j.id=due.id returning j.*;
end $$;

-- Existing campaign workers must never claim discovery work.
create or replace function public.claim_organization_job(target_org uuid default null) returns setof public.automation_jobs language plpgsql security definer set search_path='' as $$
begin
 update public.automation_jobs set status='failed',last_error='Retry limit reached after expired lease',locked_until=null,lock_token=null
 where kind not like 'autopilot_%' and status='running' and locked_until<now() and attempts>=max_attempts and (target_org is null or organization_id=target_org);
 return query with due as (
 select id from public.automation_jobs where kind not like 'autopilot_%' and (target_org is null or organization_id=target_org) and ((status='pending' and next_action_at<=now()) or (status='running' and locked_until<now())) and attempts<max_attempts order by next_action_at for update skip locked limit 1
 ) update public.automation_jobs j set status='running',attempts=attempts+1,locked_until=now()+interval '5 minutes',lock_token=gen_random_uuid() from due where j.id=due.id returning j.*;
end $$;

-- Charge before external requests; uncertain/failed requests remain charged conservatively.
create function public.reserve_autopilot_request(job_id uuid,token uuid,request_kind text,amount numeric) returns date language plpgsql set search_path='' as $$
declare j public.automation_jobs; cfg public.autopilot_settings; u public.autopilot_usage; d date:=(now() at time zone 'Europe/Bucharest')::date;
begin
 select * into j from public.automation_jobs where id=job_id and lock_token=token and status='running' and locked_until>now() for update;
 if not found or j.kind not like 'autopilot_%' then raise exception 'Invalid worker lease'; end if;
 select * into cfg from public.autopilot_settings where organization_id=j.organization_id for update;
 if not cfg.enabled or not cfg.storage_rights_confirmed then raise exception 'Autopilot paused'; end if;
 insert into public.autopilot_usage(organization_id,day) values(j.organization_id,d) on conflict do nothing;
 select * into u from public.autopilot_usage where organization_id=j.organization_id and day=d for update;
 if amount<=0 then raise exception 'Invalid request cost'; end if;
 if request_kind='search' then
  if cfg.next_api_at>now() then raise exception 'Provider rate limit; retry later'; end if;
  if u.api_requests>=cfg.daily_api_limit or u.qualified>=cfg.daily_target then return null; end if;
  update public.autopilot_usage set api_requests=api_requests+1,provider_cost_usd=provider_cost_usd+cfg.provider_request_cost_usd where organization_id=j.organization_id and day=d;
  update public.autopilot_settings set next_api_at=now()+interval '2 seconds' where organization_id=j.organization_id;
 elsif request_kind='ai' then
  if j.kind='autopilot_research' and u.qualified>=cfg.daily_target then return null; end if;
  if u.ai_cost_usd+amount>cfg.daily_ai_budget_usd then return null; end if;
  update public.autopilot_usage set ai_requests=ai_requests+1,ai_cost_usd=ai_cost_usd+amount where organization_id=j.organization_id and day=d;
 else raise exception 'Unknown request kind'; end if;
 return d;
end $$;

create function public.settle_autopilot_request(job_id uuid,token uuid,day_used date,reserved numeric,actual numeric) returns boolean language plpgsql set search_path='' as $$
declare j public.automation_jobs;
begin
 select * into j from public.automation_jobs where id=job_id and lock_token=token and status='running' and locked_until>now() for update;
 if not found or actual<0 or actual>reserved then return false; end if;
 update public.autopilot_usage set ai_cost_usd=greatest(0,ai_cost_usd-reserved+actual) where organization_id=j.organization_id and day=day_used;
 return true;
end $$;

create function public.autopilot_duplicate(org uuid,website text,email text,phone text) returns boolean language sql stable set search_path='' as $$
 select exists(select 1 from public.leads l where l.organization_id=org and (
 (nullif(lower(regexp_replace(regexp_replace(trim($2),'^https?://(www\.)?','','i'),'[/?#].*$','')),'')=l.normalized_website)
 or (nullif(lower(trim($3)),'')=l.normalized_email) or (private.prospect_phone($4) is not null and private.prospect_phone($4)=private.prospect_phone(l.phone))))
 or exists(select 1 from public.lead_contacts c where c.organization_id=org and ((nullif(lower(trim($3)),'')=lower(trim(c.email))) or (private.prospect_phone($4) is not null and private.prospect_phone($4)=private.prospect_phone(c.phone))))
 or exists(select 1 from public.suppression_list s where s.organization_id=org and s.identifier in (
 lower(trim($3)),private.prospect_phone($4),lower(regexp_replace(regexp_replace(trim($2),'^https?://(www\.)?','','i'),'[/?#].*$',''))))
 or exists(select 1 from public.autopilot_candidates c where c.organization_id=org and c.state='rejected' and c.domain=lower(regexp_replace(regexp_replace(trim($2),'^https?://(www\.)?','','i'),'[/?#].*$','')));
$$;

create function public.checkpoint_autopilot(job_id uuid,token uuid,candidate_id uuid,changes jsonb) returns boolean language plpgsql set search_path='' as $$
declare j public.automation_jobs;
begin
 select * into j from public.automation_jobs where id=job_id and lock_token=token and status='running' and locked_until>now() for update;
 if not found or j.kind not like 'autopilot_%' then raise exception 'Invalid worker lease'; end if;
 if not exists(select 1 from public.autopilot_settings where organization_id=j.organization_id and enabled) then raise exception 'Autopilot paused'; end if;
 update public.autopilot_candidates set state=coalesce(changes->>'state',state), research=coalesce(changes->'research',research),
 fit_score=coalesce((changes->>'fit_score')::integer,fit_score),confidence=coalesce((changes->>'confidence')::integer,confidence),
 researched_at=case when changes ? 'research' then now() else researched_at end,last_error=changes->>'last_error'
 where id=candidate_id and organization_id=j.organization_id;
 return found;
end $$;

create function public.save_autopilot_discovery(job_id uuid,token uuid,run_id uuid,results jsonb) returns integer language plpgsql set search_path='' as $$
declare j public.automation_jobs; item jsonb; c public.autopilot_candidates; total integer:=0; dupe boolean;
begin
 select * into j from public.automation_jobs where id=job_id and lock_token=token and status='running' and locked_until>now() for update;
 if not found or j.kind<>'autopilot_discover' or (j.payload->>'run_id')::uuid<>run_id then raise exception 'Invalid worker lease'; end if;
 if not exists(select 1 from public.autopilot_settings where organization_id=j.organization_id and enabled) then raise exception 'Autopilot paused'; end if;
 for item in select * from jsonb_array_elements(results) loop
  dupe:=public.autopilot_duplicate(j.organization_id,item->>'url',null,null);
  insert into public.autopilot_candidates(organization_id,run_id,source_url,domain,provider_title,state)
  values(j.organization_id,run_id,item->>'url',item->>'domain',item->>'title',case when dupe then 'duplicate' else 'discovered' end)
  on conflict(organization_id,run_id,domain) do nothing returning * into c;
  if found then
   total:=total+1;
   if not dupe then
    insert into public.automation_jobs(organization_id,kind,idempotency_key,payload,max_attempts)
    values(j.organization_id,'autopilot_research','autopilot:research:'||c.id,jsonb_build_object('candidate_id',c.id),3) on conflict do nothing;
   end if;
  end if;
 end loop;
 update public.automation_jobs set payload=payload||'{"discovery_saved":true}' where id=j.id;
 return total;
end $$;

create function public.defer_autopilot_budget(job_id uuid,token uuid) returns boolean language plpgsql set search_path='' as $$
begin
 update public.automation_jobs set status='pending',attempts=greatest(0,attempts-1),
 next_action_at=(((now() at time zone 'Europe/Bucharest')::date+1)+time '00:05') at time zone 'Europe/Bucharest',
 last_error='Daily budget or lead limit reached; resumes next local day',locked_until=null,lock_token=null
 where id=job_id and lock_token=token and kind like 'autopilot_%' and status='running' and locked_until>now();
 return found;
end $$;

-- Commit lead, qualification quota and next job in one transaction, fenced by lease.
create function public.commit_autopilot_lead(job_id uuid,token uuid,candidate_id uuid,prospect jsonb) returns uuid language plpgsql set search_path='' as $$
declare j public.automation_jobs; cfg public.autopilot_settings; c public.autopilot_candidates; u public.autopilot_usage; target uuid; d date:=(now() at time zone 'Europe/Bucharest')::date;
begin
 select * into j from public.automation_jobs where id=job_id and lock_token=token and status='running' and locked_until>now() for update;
 if not found or j.kind<>'autopilot_research' then raise exception 'Invalid worker lease'; end if;
 select * into cfg from public.autopilot_settings where organization_id=j.organization_id for update;
 if not cfg.enabled then raise exception 'Autopilot paused'; end if;
 select * into c from public.autopilot_candidates where id=candidate_id and organization_id=j.organization_id for update;
 if not found then raise exception 'Candidate not found'; end if;
 if c.lead_id is not null then return c.lead_id; end if;
 if public.autopilot_duplicate(j.organization_id,c.source_url,prospect->>'email',prospect->>'phone') then
  update public.autopilot_candidates set state='duplicate',last_error='Already present or suppressed' where id=c.id; return null;
 end if;
 insert into public.autopilot_usage(organization_id,day) values(j.organization_id,d) on conflict do nothing;
 select * into u from public.autopilot_usage where organization_id=j.organization_id and day=d for update;
 if u.qualified>=cfg.daily_target then update public.autopilot_candidates set state='limited',last_error='Daily lead target reached' where id=c.id; return null; end if;
 begin
  insert into public.leads(organization_id,company_name,niche,city,country,website,email,phone,source,status,lead_score,website_summary,verified_facts,enriched_at,notes)
  values(j.organization_id,prospect->>'company_name',cfg.specialty,prospect->>'city','RO',c.source_url,prospect->>'email',private.prospect_phone(prospect->>'phone'),'autopilot:brave_search','READY_FOR_OUTREACH',c.fit_score,prospect->>'summary',prospect->'facts',now(),
   'Source: '||c.source_url||'; discovered: '||c.discovered_at||'; confidence: '||c.confidence) returning id into target;
 exception when unique_violation then
  update public.autopilot_candidates set state='duplicate',last_error='Duplicate blocked atomically' where id=c.id; return null;
 end;
 update public.autopilot_usage set qualified=qualified+1 where organization_id=j.organization_id and day=d;
 update public.autopilot_candidates set state='qualified',lead_id=target where id=c.id;
 insert into public.automation_jobs(organization_id,lead_id,kind,idempotency_key,payload,max_attempts)
 values(j.organization_id,target,'autopilot_draft','autopilot:draft:'||target,jsonb_build_object('candidate_id',c.id),3) on conflict do nothing;
 return target;
end $$;

create function public.commit_autopilot_draft(job_id uuid,token uuid,candidate_id uuid,draft jsonb) returns uuid language plpgsql set search_path='' as $$
declare j public.automation_jobs; c public.autopilot_candidates; m uuid; l public.leads;
begin
 select * into j from public.automation_jobs where id=job_id and lock_token=token and status='running' and locked_until>now() for update;
 if not found or j.kind<>'autopilot_draft' then raise exception 'Invalid worker lease'; end if;
 if not exists(select 1 from public.autopilot_settings where organization_id=j.organization_id and enabled) then raise exception 'Autopilot paused'; end if;
 select * into c from public.autopilot_candidates where id=candidate_id and organization_id=j.organization_id for update;
 select * into l from public.leads where id=j.lead_id and organization_id=j.organization_id for update;
 if c.lead_id is distinct from l.id or l.do_not_contact or l.status in ('LOST','DO_NOT_CONTACT') or exists(select 1 from public.suppression_list s where s.organization_id=j.organization_id and (s.lead_id=l.id or s.identifier in (l.normalized_email,private.prospect_phone(l.phone),l.normalized_website))) then
  update public.autopilot_candidates set state='rejected',last_error='Suppressed or rejected before drafting' where id=c.id; return null;
 end if;
 insert into public.messages(organization_id,lead_id,direction,subject,body,status,model,idempotency_key,metadata)
 values(j.organization_id,l.id,'outbound',draft->>'subject',draft->>'body','draft',draft->>'model','autopilot:draft:'||l.id,coalesce(draft->'metadata','{}')||jsonb_build_object('autopilot',true,'source_url',c.source_url,'requires_human_approval',true))
 on conflict(organization_id,idempotency_key) do nothing;
 select id into m from public.messages where organization_id=j.organization_id and idempotency_key='autopilot:draft:'||l.id;
 update public.autopilot_candidates set state='drafted' where id=c.id;
 return m;
end $$;

-- Worker functions are service-role only, including invoker functions.
revoke all on function private.prospect_phone(text) from public,anon;
grant execute on function private.prospect_phone(text) to authenticated,service_role;
revoke all on function public.schedule_autopilot(uuid),public.claim_autopilot_job(uuid),public.reserve_autopilot_request(uuid,uuid,text,numeric),public.settle_autopilot_request(uuid,uuid,date,numeric,numeric),public.autopilot_duplicate(uuid,text,text,text),public.commit_autopilot_lead(uuid,uuid,uuid,jsonb),public.commit_autopilot_draft(uuid,uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.schedule_autopilot(uuid),public.claim_autopilot_job(uuid),public.reserve_autopilot_request(uuid,uuid,text,numeric),public.settle_autopilot_request(uuid,uuid,date,numeric,numeric),public.autopilot_duplicate(uuid,text,text,text),public.commit_autopilot_lead(uuid,uuid,uuid,jsonb),public.commit_autopilot_draft(uuid,uuid,uuid,jsonb) to service_role;
revoke all on function public.checkpoint_autopilot(uuid,uuid,uuid,jsonb),public.save_autopilot_discovery(uuid,uuid,uuid,jsonb),public.defer_autopilot_budget(uuid,uuid) from public,anon,authenticated;
grant execute on function public.checkpoint_autopilot(uuid,uuid,uuid,jsonb),public.save_autopilot_discovery(uuid,uuid,uuid,jsonb),public.defer_autopilot_budget(uuid,uuid) to service_role;

create function public.autopilot_scheduler_status() returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb;
begin
 if not exists(select 1 from pg_extension where extname='pg_cron') then return '{"enabled":false}'::jsonb; end if;
 execute 'select jsonb_build_object(''enabled'',active,''schedule'',schedule) from cron.job where jobname=''voxa-growth-autopilot''' into result;
 return coalesce(result,'{"enabled":false}'::jsonb);
end $$;
revoke all on function public.autopilot_scheduler_status() from public,anon,authenticated;
grant execute on function public.autopilot_scheduler_status() to service_role;

create function public.autopilot_run_metrics(org uuid) returns jsonb language sql stable set search_path='' as $$
 select coalesce(jsonb_agg(result order by day desc),'[]') from (
 select r.day,to_jsonb(r)||jsonb_build_object(
  'discovered',(select count(*) from public.autopilot_candidates c where c.run_id=r.id),
  'duplicates',(select count(*) from public.autopilot_candidates c where c.run_id=r.id and c.state='duplicate'),
  'qualified',(select count(*) from public.autopilot_candidates c where c.run_id=r.id and c.lead_id is not null),
  'drafts_ready',(select count(*) from public.autopilot_candidates c join public.messages m on m.lead_id=c.lead_id and m.organization_id=c.organization_id and m.idempotency_key='autopilot:draft:'||c.lead_id where c.run_id=r.id and m.status='draft'),
  'failures',(select count(*) from public.automation_jobs j where j.organization_id=org and j.status='failed' and (j.payload->>'run_id'=r.id::text or j.payload->>'candidate_id' in (select c.id::text from public.autopilot_candidates c where c.run_id=r.id))),
  'rejected',(select count(*) from public.autopilot_candidates c where c.run_id=r.id and c.state='rejected')
 ) as result from public.autopilot_runs r where organization_id=org order by r.day desc limit 30) summary;
$$;
revoke all on function public.autopilot_run_metrics(uuid) from public,anon,authenticated;
grant execute on function public.autopilot_run_metrics(uuid) to service_role;

create function public.refresh_autopilot_runs(target_org uuid default null) returns void language plpgsql set search_path='' as $$
begin
 update public.autopilot_runs r set status=case
  when exists(select 1 from public.automation_jobs j where j.organization_id=r.organization_id and j.status in ('running','pending') and (j.payload->>'run_id'=r.id::text or j.payload->>'candidate_id' in(select c.id::text from public.autopilot_candidates c where c.run_id=r.id))) then 'running'
  when coalesce(u.qualified,0)>=(r.targeting->>'daily_target')::integer then 'completed'
  when coalesce(u.api_requests,0)>=(r.targeting->>'daily_api_limit')::integer or coalesce(u.ai_cost_usd,0)>=(r.targeting->>'daily_ai_budget_usd')::numeric then 'limited'
  when exists(select 1 from public.automation_jobs j where j.organization_id=r.organization_id and j.status='failed' and j.payload->>'run_id'=r.id::text) then 'failed'
  else 'running' end
 from public.autopilot_usage u where u.organization_id=r.organization_id and u.day=r.day and (target_org is null or r.organization_id=target_org);
end $$;
revoke all on function public.refresh_autopilot_runs(uuid) from public,anon,authenticated;
grant execute on function public.refresh_autopilot_runs(uuid) to service_role;
