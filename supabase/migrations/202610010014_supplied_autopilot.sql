-- User-supplied leads reuse the existing research, qualification and draft queue.
alter table public.autopilot_settings add column input_mode text not null default 'supplied' check(input_mode in ('supplied','brave_search'));
alter table public.autopilot_settings add column selected_lead_ids uuid[] not null default '{}' check(cardinality(selected_lead_ids)<=100);
update public.autopilot_settings set enabled=false;
alter table public.autopilot_candidates add column input_lead_id uuid;
alter table public.autopilot_candidates add foreign key(organization_id,input_lead_id) references public.leads(organization_id,id);
create unique index autopilot_supplied_once_idx on public.autopilot_candidates(organization_id,input_lead_id) where input_lead_id is not null;
create or replace function public.autopilot_supplied_duplicate(org uuid,website text,email text,phone text,exclude_lead uuid) returns boolean language sql stable set search_path='' as $$
 select exists(select 1 from public.leads l where l.organization_id=org and l.id<>exclude_lead and (
 (nullif(lower(regexp_replace(regexp_replace(trim($2),'^https?://(www\.)?','','i'),'[/?#].*$','')),'')=l.normalized_website)
 or (nullif(lower(trim($3)),'')=l.normalized_email) or (private.prospect_phone($4) is not null and private.prospect_phone($4)=private.prospect_phone(l.phone))))
 or exists(select 1 from public.lead_contacts c where c.organization_id=org and c.lead_id<>exclude_lead and ((nullif(lower(trim($3)),'')=lower(trim(c.email))) or (private.prospect_phone($4) is not null and private.prospect_phone($4)=private.prospect_phone(c.phone))))
 or exists(select 1 from public.suppression_list s where s.organization_id=org and (s.lead_id=exclude_lead or s.identifier in (
 lower(trim($3)),private.prospect_phone($4),lower(regexp_replace(regexp_replace(trim($2),'^https?://(www\.)?','','i'),'[/?#].*$','')))))
 or exists(select 1 from public.autopilot_candidates c where c.organization_id=org and c.state='rejected' and c.domain=lower(regexp_replace(regexp_replace(trim($2),'^https?://(www\.)?','','i'),'[/?#].*$','')));
$$;
create or replace function public.reserve_autopilot_request(job_id uuid,token uuid,request_kind text,amount numeric) returns date language plpgsql set search_path='' as $$
declare j public.automation_jobs; cfg public.autopilot_settings; u public.autopilot_usage; d date:=(now() at time zone 'Europe/Bucharest')::date;
begin
 select * into j from public.automation_jobs where id=job_id and lock_token=token and status='running' and locked_until>now() for update;
 if not found or j.kind not like 'autopilot_%' then raise exception 'Invalid worker lease'; end if;
 select * into cfg from public.autopilot_settings where organization_id=j.organization_id for update;
 if not cfg.enabled or (cfg.input_mode='brave_search' and not cfg.storage_rights_confirmed) then raise exception 'Autopilot paused'; end if;
 insert into public.autopilot_usage(organization_id,day) values(j.organization_id,d) on conflict do nothing;
 select * into u from public.autopilot_usage where organization_id=j.organization_id and day=d for update;
 if amount<=0 then raise exception 'Invalid request cost'; end if;
 if request_kind='search' then
  if cfg.input_mode<>'brave_search' then raise exception 'Search disabled in supplied mode'; end if;
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
create or replace function public.commit_autopilot_lead(job_id uuid,token uuid,candidate_id uuid,prospect jsonb) returns uuid language plpgsql set search_path='' as $$
declare j public.automation_jobs; cfg public.autopilot_settings; c public.autopilot_candidates; u public.autopilot_usage; target uuid; d date:=(now() at time zone 'Europe/Bucharest')::date;
begin
 select * into j from public.automation_jobs where id=job_id and lock_token=token and status='running' and locked_until>now() for update;
 if not found or j.kind<>'autopilot_research' then raise exception 'Invalid worker lease'; end if;
 select * into cfg from public.autopilot_settings where organization_id=j.organization_id for update;
 if not cfg.enabled then raise exception 'Autopilot paused'; end if;
 select * into c from public.autopilot_candidates where id=candidate_id and organization_id=j.organization_id for update;
 if not found then raise exception 'Candidate not found'; end if;
 if c.lead_id is not null then return c.lead_id; end if;
 if (c.input_lead_id is null and public.autopilot_duplicate(j.organization_id,c.source_url,prospect->>'email',prospect->>'phone')) or (c.input_lead_id is not null and public.autopilot_supplied_duplicate(j.organization_id,c.source_url,prospect->>'email',prospect->>'phone',c.input_lead_id)) then
  update public.autopilot_candidates set state='duplicate',last_error='Already present or suppressed' where id=c.id; return null;
 end if;
 insert into public.autopilot_usage(organization_id,day) values(j.organization_id,d) on conflict do nothing;
 select * into u from public.autopilot_usage where organization_id=j.organization_id and day=d for update;
 if u.qualified>=cfg.daily_target then update public.autopilot_candidates set state='limited',last_error='Daily lead target reached' where id=c.id; return null; end if;
 if c.input_lead_id is not null then
  select id into target from public.leads where id=c.input_lead_id and organization_id=j.organization_id and not do_not_contact and status not in ('LOST','DO_NOT_CONTACT') for update;
  if target is null then update public.autopilot_candidates set state='rejected',last_error='Lead suppressed or rejected' where id=c.id; return null; end if;
  update public.leads set lead_score=c.fit_score,website_summary=prospect->>'summary',verified_facts=prospect->'facts',enriched_at=now() where id=target;
 else
 begin
  insert into public.leads(organization_id,company_name,niche,city,country,website,email,phone,source,status,lead_score,website_summary,verified_facts,enriched_at,notes)
  values(j.organization_id,prospect->>'company_name',cfg.specialty,prospect->>'city','RO',c.source_url,prospect->>'email',private.prospect_phone(prospect->>'phone'),'autopilot:brave_search','READY_FOR_OUTREACH',c.fit_score,prospect->>'summary',prospect->'facts',now(),
   'Source: '||c.source_url||'; discovered: '||c.discovered_at||'; confidence: '||c.confidence) returning id into target;
 exception when unique_violation then
  update public.autopilot_candidates set state='duplicate',last_error='Duplicate blocked atomically' where id=c.id; return null;
 end;
 end if;
 update public.autopilot_usage set qualified=qualified+1 where organization_id=j.organization_id and day=d;
 update public.autopilot_candidates set state='qualified',lead_id=target where id=c.id;
 insert into public.automation_jobs(organization_id,lead_id,kind,idempotency_key,payload,max_attempts)
 values(j.organization_id,target,'autopilot_draft','autopilot:draft:'||target,jsonb_build_object('candidate_id',c.id),3) on conflict do nothing;
 return target;
end $$;
create or replace function public.schedule_discovery_autopilot(target_org uuid default null) returns void language plpgsql set search_path='' as $$
declare cfg public.autopilot_settings; run public.autopilot_runs; usage public.autopilot_usage; d date:=(now() at time zone 'Europe/Bucharest')::date;
begin
 perform public.refresh_autopilot_runs(target_org);
 for cfg in select * from public.autopilot_settings where input_mode='brave_search' and enabled and daily_ai_budget_usd>0 and storage_rights_confirmed and (target_org is null or organization_id=target_org) for update skip locked loop
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
create or replace function public.schedule_autopilot(target_org uuid default null) returns void language plpgsql set search_path='' as $$
declare cfg public.autopilot_settings; r public.autopilot_runs; l public.leads; c public.autopilot_candidates; u public.autopilot_usage; d date:=(now() at time zone 'Europe/Bucharest')::date; n integer;
begin
 perform public.schedule_discovery_autopilot(target_org);
 for cfg in select * from public.autopilot_settings where input_mode='supplied' and enabled and daily_ai_budget_usd>0 and (target_org is null or organization_id=target_org) for update skip locked loop
  insert into public.autopilot_usage(organization_id,day) values(cfg.organization_id,d) on conflict do nothing;
  select * into u from public.autopilot_usage where organization_id=cfg.organization_id and day=d;
  if u.qualified>=cfg.daily_target or u.ai_cost_usd>=cfg.daily_ai_budget_usd then continue; end if;
  if exists(select 1 from public.automation_jobs where organization_id=cfg.organization_id and kind like 'autopilot_%' and status in ('pending','running')) then continue; end if;
  n:=0;
  for l in select * from public.leads where organization_id=cfg.organization_id and id=any(cfg.selected_lead_ids) and not do_not_contact and status not in ('LOST','DO_NOT_CONTACT') and website ~ '^https?://' and coalesce(source,'') !~* 'demo|synthetic|dry.run|controlled.test' and not exists(select 1 from public.autopilot_candidates prior where prior.organization_id=cfg.organization_id and prior.input_lead_id=leads.id) order by created_at,id limit 100 loop
   if n>=cfg.daily_target-u.qualified then exit; end if;
   if public.autopilot_supplied_duplicate(cfg.organization_id,l.website,l.email,l.phone,l.id) then continue; end if;
   insert into public.autopilot_runs(organization_id,day,targeting) values(cfg.organization_id,d,to_jsonb(cfg)-'last_error') on conflict do nothing;
   select * into r from public.autopilot_runs where organization_id=cfg.organization_id and day=d;
   insert into public.autopilot_candidates(organization_id,run_id,source_url,domain,provider,provider_title,input_lead_id) values(cfg.organization_id,r.id,l.website,l.normalized_website,'supplied',l.company_name,l.id) on conflict do nothing returning * into c;
   if found then
    insert into public.automation_jobs(organization_id,lead_id,kind,idempotency_key,payload,max_attempts) values(cfg.organization_id,l.id,'autopilot_research','autopilot:research:'||c.id,jsonb_build_object('candidate_id',c.id),3) on conflict do nothing;
    n:=n+1;
   end if;
  end loop;
 end loop;
end $$;
revoke all on function public.autopilot_supplied_duplicate(uuid,text,text,text,uuid), public.schedule_discovery_autopilot(uuid) from public,anon,authenticated;
grant execute on function public.autopilot_supplied_duplicate(uuid,text,text,text,uuid), public.schedule_discovery_autopilot(uuid) to service_role;

create or replace function public.refresh_autopilot_runs(target_org uuid default null) returns void language plpgsql set search_path='' as $$
begin
 update public.autopilot_runs r set status=case
  when exists(select 1 from public.automation_jobs j where j.organization_id=r.organization_id and j.status in ('running','pending') and (j.payload->>'run_id'=r.id::text or j.payload->>'candidate_id' in(select c.id::text from public.autopilot_candidates c where c.run_id=r.id))) then 'running'
  when coalesce(u.qualified,0)>=(r.targeting->>'daily_target')::integer then 'completed'
  when coalesce(u.api_requests,0)>=(r.targeting->>'daily_api_limit')::integer or coalesce(u.ai_cost_usd,0)>=(r.targeting->>'daily_ai_budget_usd')::numeric then 'limited'
  when exists(select 1 from public.automation_jobs j where j.organization_id=r.organization_id and j.status='failed' and j.payload->>'run_id'=r.id::text) then 'failed'
  else 'completed' end
 from public.autopilot_usage u where u.organization_id=r.organization_id and u.day=r.day and (target_org is null or r.organization_id=target_org);
end $$;

