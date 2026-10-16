-- Verified contacts replace invalid imported placeholders; failures are counted across research and draft jobs.
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
  update public.leads set email=prospect->>'email',phone=private.prospect_phone(prospect->>'phone'),lead_score=c.fit_score,website_summary=prospect->>'summary',verified_facts=prospect->'facts',enriched_at=now() where id=target;
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
create or replace function public.refresh_autopilot_runs(target_org uuid default null) returns void language plpgsql set search_path='' as $$
begin
 update public.autopilot_runs r set status=case
  when exists(select 1 from public.automation_jobs j where j.organization_id=r.organization_id and j.status in ('running','pending') and (j.payload->>'run_id'=r.id::text or j.payload->>'candidate_id' in(select c.id::text from public.autopilot_candidates c where c.run_id=r.id))) then 'running'
  when coalesce(u.qualified,0)>=(r.targeting->>'daily_target')::integer then 'completed'
  when coalesce(u.api_requests,0)>=(r.targeting->>'daily_api_limit')::integer or coalesce(u.ai_cost_usd,0)>=(r.targeting->>'daily_ai_budget_usd')::numeric then 'limited'
  when exists(select 1 from public.automation_jobs j where j.organization_id=r.organization_id and j.status='failed' and (j.payload->>'run_id'=r.id::text or j.payload->>'candidate_id' in(select source.id::text from public.autopilot_candidates source where source.run_id=r.id))) then 'failed'
  else 'completed' end
 from public.autopilot_usage u where u.organization_id=r.organization_id and u.day=r.day and (target_org is null or r.organization_id=target_org);
end $$;