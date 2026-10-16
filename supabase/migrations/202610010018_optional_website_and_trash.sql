-- Supplied prospects may have no website; retain unknown provenance without fabricated URLs.
alter table public.autopilot_settings alter column require_website set default false;
update public.autopilot_settings set require_website=false where input_mode='supplied';
alter table public.autopilot_candidates alter column source_url drop not null;
alter table public.autopilot_candidates alter column domain drop not null;
alter table public.leads add column deleted_at timestamptz;
alter table public.leads add column deletion_state jsonb;
create index leads_active_recent_idx on public.leads(organization_id,created_at desc,id) where deleted_at is null;
create index leads_trash_idx on public.leads(organization_id,deleted_at desc) where deleted_at is not null;
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
  for l in select * from public.leads where organization_id=cfg.organization_id and id=any(cfg.selected_lead_ids) and not do_not_contact and status not in ('LOST','DO_NOT_CONTACT') and deleted_at is null and (not cfg.require_website or website ~ '^https?://') and coalesce(source,'') !~* 'demo|synthetic|dry.run|controlled.test' and not exists(select 1 from public.autopilot_candidates prior where prior.organization_id=cfg.organization_id and prior.input_lead_id=leads.id) order by created_at,id limit 100 loop
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

-- Only the trusted API may invoke these atomic, tenant-scoped actions.
create function public.trash_leads(org uuid,targets uuid[],actor uuid) returns integer language plpgsql security definer set search_path='' as $$
declare l public.leads; n integer:=0;
begin
 if cardinality(targets) not between 1 and 500 or not exists(select 1 from public.organization_members where organization_id=org and user_id=actor and role in ('owner','admin')) then raise exception 'Administrator required'; end if;
 if (select count(*) from public.leads where organization_id=org and id=any(targets))<>(select count(distinct v) from unnest(targets) v) then raise exception 'Inaccessible lead'; end if;
 -- Worker locks precede lead locks, matching the commit order; cancelled leases cannot commit.
 update public.automation_jobs set status='cancelled',locked_until=null,lock_token=null,last_error='Lead moved to trash' where organization_id=org and lead_id=any(targets) and status in ('pending','running');
 for l in select * from public.leads where organization_id=org and id=any(targets) and deleted_at is null order by id for update loop
  update public.leads set deletion_state=jsonb_build_object('status',l.status,'do_not_contact',l.do_not_contact),deleted_at=now(),do_not_contact=true,status='DO_NOT_CONTACT' where id=l.id and organization_id=org;
  update public.campaign_leads set stopped_at=coalesce(stopped_at,now()),stop_reason='Lead moved to trash' where organization_id=org and lead_id=l.id;
  insert into public.activities(organization_id,actor_id,action,entity_table,entity_id,lead_id,details) values(org,actor,'lead_trash','leads',l.id,l.id,'{}');
  n:=n+1;
 end loop;
 update public.autopilot_settings set selected_lead_ids=array(select v from unnest(selected_lead_ids) v where not(v=any(targets))) where organization_id=org;
 return n;
end $$;
create function public.restore_leads(org uuid,targets uuid[],actor uuid) returns integer language plpgsql security definer set search_path='' as $$
declare l public.leads; n integer:=0; suppressed boolean;
begin
 if cardinality(targets) not between 1 and 500 or not exists(select 1 from public.organization_members where organization_id=org and user_id=actor and role in ('owner','admin')) then raise exception 'Administrator required'; end if;
 if (select count(*) from public.leads where organization_id=org and id=any(targets))<>(select count(distinct v) from unnest(targets) v) then raise exception 'Inaccessible lead'; end if;
 for l in select * from public.leads where organization_id=org and id=any(targets) and deleted_at is not null order by id for update loop
  suppressed:=exists(select 1 from public.suppression_list s where s.organization_id=org and (s.lead_id=l.id or s.identifier in(l.normalized_email,l.normalized_website,private.prospect_phone(l.phone))));
  update public.leads set deleted_at=null,status=case when suppressed then 'DO_NOT_CONTACT'::public.lead_status else coalesce((l.deletion_state->>'status')::public.lead_status,'NEW'::public.lead_status) end,do_not_contact=suppressed or coalesce((l.deletion_state->>'do_not_contact')::boolean,false),deletion_state=null where id=l.id and organization_id=org;
  insert into public.activities(organization_id,actor_id,action,entity_table,entity_id,lead_id,details) values(org,actor,'lead_restore','leads',l.id,l.id,'{}');
  n:=n+1;
 end loop;
 -- Outbound jobs/messages/campaigns remain stopped; recovery never sends or activates.
 return n;
end $$;
revoke all on function public.trash_leads(uuid,uuid[],uuid),public.restore_leads(uuid,uuid[],uuid) from public,anon,authenticated;
grant execute on function public.trash_leads(uuid,uuid[],uuid),public.restore_leads(uuid,uuid[],uuid) to service_role;
