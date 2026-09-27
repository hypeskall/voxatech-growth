-- Operational hardening found during the weekday-unattended audit.

-- A lead has one active campaign journey. Reassigning is atomic and leaves history intact.
with ranked as (
  select id,row_number() over(partition by organization_id,lead_id order by created_at desc,id desc) as position
  from public.campaign_leads where stopped_at is null
)
update public.campaign_leads cl set stopped_at=now(),stop_reason='reassigned_during_hardening',next_action_at=null
from ranked r where cl.id=r.id and r.position>1;
create unique index campaign_leads_one_active on public.campaign_leads(organization_id,lead_id) where stopped_at is null;

create function public.assign_leads_to_campaign(org uuid,target_campaign uuid,target_leads uuid[])
returns integer language plpgsql security definer set search_path='' as $$
declare c public.campaigns; target uuid; l public.leads; assigned integer:=0;
begin
 select * into c from public.campaigns where organization_id=org and id=target_campaign;
 if not found then raise exception 'Campaign not found'; end if;
 foreach target in array target_leads loop
  select * into l from public.leads where organization_id=org and id=target for update;
  if not found then raise exception 'Lead not found'; end if;
  if l.do_not_contact or l.status in ('DO_NOT_CONTACT','LOST','WON') then raise exception 'Lead cannot be assigned'; end if;
  if not private.campaign_matches(c,l) then raise exception 'Lead does not match campaign audience'; end if;
  update public.campaign_leads set stopped_at=now(),stop_reason='reassigned',next_action_at=null
   where organization_id=org and lead_id=target and campaign_id<>target_campaign and stopped_at is null;
  insert into public.campaign_leads(organization_id,campaign_id,lead_id,stopped_at,stop_reason,step,next_action_at)
  values(org,target_campaign,target,null,null,0,null)
  on conflict(organization_id,campaign_id,lead_id) do update set stopped_at=null,stop_reason=null,step=0,next_action_at=null;
  assigned:=assigned+1;
 end loop;
 return assigned;
end; $$;
revoke all on function public.assign_leads_to_campaign(uuid,uuid,uuid[]) from public,anon,authenticated;
grant execute on function public.assign_leads_to_campaign(uuid,uuid,uuid[]) to service_role;

-- Local dry-run delivery exercises the same safety gates and records a clearly simulated send.
create function public.simulate_outbound_message(message_id uuid) returns setof public.messages
language plpgsql security definer set search_path='' as $$
declare m public.messages; c public.campaigns; l public.leads; transactional boolean; human_approved boolean;
begin
 select * into m from public.messages where id=message_id for update;
 if not found or m.direction<>'outbound' or m.status not in ('approved','queued') then return; end if;
 select * into l from public.leads where id=m.lead_id and organization_id=m.organization_id for update;
 transactional:=coalesce(m.metadata->>'transactional_onboarding','false')='true';
 human_approved:=coalesce(m.metadata->>'human_approved','false')='true';
 if l.email is null or l.do_not_contact or l.status in ('DO_NOT_CONTACT','LOST')
    or (l.status='WON' and not transactional) or (l.status='HUMAN_REQUIRED' and not human_approved)
    or exists(select 1 from public.suppression_list s where s.organization_id=m.organization_id and (s.lead_id=m.lead_id or (s.channel in ('all','email') and s.identifier=lower(trim(l.email))))) then return; end if;
 if not transactional then
  select * into c from public.campaigns where id=m.campaign_id and organization_id=m.organization_id for update;
  if not found or c.status<>'active' or c.activated_by is null or not private.campaign_matches(c,l) then return; end if;
  if m.follow_up_number>c.max_follow_ups then return; end if;
  if c.mode='approval_required' and m.approved_by is null then return; end if;
 end if;
 if m.follow_up_number is not null and exists(select 1 from public.messages r where r.organization_id=m.organization_id and r.lead_id=m.lead_id and r.direction='inbound') then return; end if;
 if m.follow_up_number=0 and exists(select 1 from public.messages previous where previous.organization_id=m.organization_id and previous.lead_id=m.lead_id and previous.id<>m.id and previous.direction='outbound' and previous.follow_up_number=0 and previous.status in ('sent','delivered','opened')) then return; end if;
 update public.messages set status='sent',sent_at=now(),reserved_at=now(),provider='local-dry-run',provider_message_id='local:'||id,
  metadata=metadata||jsonb_build_object('simulated',true,'simulated_at',now()) where id=m.id returning * into m;
 return next m;
end; $$;
revoke all on function public.simulate_outbound_message(uuid) from public,anon,authenticated;
grant execute on function public.simulate_outbound_message(uuid) to service_role;

create or replace function public.reserve_outbound_message(message_id uuid) returns setof public.messages language plpgsql security definer set search_path='' as $$
declare m public.messages; c public.campaigns; l public.leads; local_now timestamp; sent_count integer; transactional boolean; human_approved boolean;
begin
 select * into m from public.messages where id=message_id for update;
 if not found or m.direction<>'outbound' or m.status not in ('approved','queued','sending') then return; end if;
 select * into l from public.leads where id=m.lead_id and organization_id=m.organization_id for update;
 transactional:=coalesce(m.metadata->>'transactional_onboarding','false')='true';
 human_approved:=coalesce(m.metadata->>'human_approved','false')='true';
 if l.email is null or l.do_not_contact or l.status in ('DO_NOT_CONTACT','LOST')
    or (l.status='WON' and not transactional) or (l.status='HUMAN_REQUIRED' and not human_approved)
    or exists(select 1 from public.suppression_list s where s.organization_id=m.organization_id and (s.lead_id=m.lead_id or (s.channel in ('all','email') and s.identifier=lower(trim(l.email))))) then return; end if;
 if not transactional then
  select * into c from public.campaigns where id=m.campaign_id and organization_id=m.organization_id for update;
  if not found or c.status<>'active' or c.activated_by is null or not private.campaign_matches(c,l) then return; end if;
  if m.follow_up_number>c.max_follow_ups then return; end if;
  if c.mode='approval_required' and m.approved_by is null then return; end if;
 end if;
 if m.follow_up_number is not null and exists(select 1 from public.messages r where r.organization_id=m.organization_id and r.lead_id=m.lead_id and r.direction='inbound') then return; end if;
 if m.follow_up_number=0 and exists(select 1 from public.messages previous where previous.organization_id=m.organization_id and previous.lead_id=m.lead_id and previous.id<>m.id and previous.direction='outbound' and previous.follow_up_number=0 and previous.status in ('sent','delivered','opened')) then return; end if;
 if m.status='sending' then
  if m.reserved_at>now()-interval '23 hours' then return next m; end if;
  return;
 end if;
 if not transactional then
  local_now=now() at time zone 'Europe/Bucharest';
  if (c.weekdays_only and extract(isodow from local_now)>5) or local_now::time<c.window_start or local_now::time>=c.window_end or c.next_send_at>now() then return; end if;
  select count(*) into sent_count from public.messages where campaign_id=c.id and (reserved_at at time zone 'Europe/Bucharest')::date=local_now::date;
  if sent_count>=c.daily_cap then return; end if;
  update public.campaigns set next_send_at=now()+make_interval(secs=>60+floor(random()*120)::integer) where id=c.id;
 end if;
 update public.messages set status='sending',reserved_at=now() where id=m.id returning * into m;
 return next m;
end; $$;

-- Put deferred deliveries at the next campaign window instead of reclaiming the same jobs every 15 minutes overnight.
create or replace function public.defer_automation_job(job_id uuid,token uuid) returns boolean language plpgsql security definer set search_path='' as $$
declare resume_at timestamptz:=now()+interval '15 minutes'; local_now timestamp; start_at time; weekdays boolean; candidate date;
begin
 select c.window_start,c.weekdays_only into start_at,weekdays
 from public.automation_jobs j join public.messages m on m.id=(j.payload->>'message_id')::uuid left join public.campaigns c on c.id=m.campaign_id
 where j.id=job_id;
 if start_at is not null then
  local_now=now() at time zone 'Europe/Bucharest'; candidate=local_now::date;
  if local_now::time>=start_at then candidate=candidate+1; end if;
  while weekdays and extract(isodow from candidate)>5 loop candidate=candidate+1; end loop;
  resume_at=greatest(resume_at,(candidate+start_at) at time zone 'Europe/Bucharest');
 end if;
 update public.automation_jobs set status='pending',attempts=greatest(0,attempts-1),next_action_at=resume_at,lock_token=null,locked_until=null
 where id=job_id and lock_token=token and status='running' and locked_until>now();
 return found;
end; $$;

create or replace function private.reject_suppressed_queue() returns trigger language plpgsql security definer set search_path='' as $$
declare human_approved boolean; transactional boolean;
begin
 human_approved:=coalesce(new.metadata->>'human_approved','false')='true';
 transactional:=coalesce(new.metadata->>'transactional_onboarding','false')='true';
 if new.direction='outbound' and new.status in ('queued','approved','sending') and exists(
  select 1 from public.leads l where l.id=new.lead_id and l.organization_id=new.organization_id and
  (l.do_not_contact or l.status='LOST' or (l.status='WON' and not transactional) or (l.status='HUMAN_REQUIRED' and not human_approved))
 ) then raise exception 'Lead cannot receive outbound messages'; end if;
 return new;
end; $$;

create or replace function public.schedule_due_jobs(target_org uuid default null,delivery_mode text default 'log') returns void language plpgsql security definer set search_path='' as $$
begin
 insert into public.automation_jobs(organization_id,lead_id,kind,idempotency_key,payload)
 select m.organization_id,m.lead_id,'send_due_messages','send:'||delivery_mode||':'||m.id,jsonb_build_object('message_id',m.id)
 from public.messages m join public.leads l on l.id=m.lead_id and l.organization_id=m.organization_id
 where m.direction='outbound' and m.status in ('approved','queued','sending') and not l.do_not_contact
 and (l.status not in ('LOST','HUMAN_REQUIRED','WON') or coalesce(m.metadata->>'human_approved','false')='true' or coalesce(m.metadata->>'transactional_onboarding','false')='true')
 and (target_org is null or m.organization_id=target_org)
 on conflict(organization_id,idempotency_key) do nothing;
 insert into public.automation_jobs(organization_id,lead_id,kind,idempotency_key,payload)
 select c.organization_id,cl.lead_id,'create_outreach_drafts','initial:'||c.id||':'||cl.lead_id,jsonb_build_object('campaign_id',c.id,'step',0)
 from public.campaigns c join public.campaign_leads cl on cl.campaign_id=c.id and cl.organization_id=c.organization_id join public.leads l on l.id=cl.lead_id and l.organization_id=cl.organization_id
 where c.status='active' and private.campaign_matches(c,l) and cl.stopped_at is null and not l.do_not_contact and l.status not in ('LOST','HUMAN_REQUIRED','WON') and (target_org is null or c.organization_id=target_org)
 and not exists(select 1 from public.messages m where m.organization_id=c.organization_id and m.lead_id=cl.lead_id and m.direction='outbound' and m.follow_up_number=0)
 on conflict(organization_id,idempotency_key) do nothing;
 insert into public.automation_jobs(organization_id,lead_id,kind,idempotency_key,payload)
 select c.organization_id,cl.lead_id,'process_follow_ups','follow:'||c.id||':'||cl.lead_id||':'||(last_message.follow_up_number+1),jsonb_build_object('campaign_id',c.id,'step',last_message.follow_up_number+1)
 from public.campaigns c join public.campaign_leads cl on cl.campaign_id=c.id and cl.organization_id=c.organization_id join public.leads l on l.id=cl.lead_id and l.organization_id=cl.organization_id
 cross join lateral(select m.follow_up_number,m.sent_at from public.messages m where m.organization_id=c.organization_id and m.campaign_id=c.id and m.lead_id=cl.lead_id and m.sent_at is not null and m.follow_up_number is not null order by m.follow_up_number desc limit 1) last_message
 where c.status='active' and private.campaign_matches(c,l) and cl.stopped_at is null and not l.do_not_contact and l.status not in ('LOST','HUMAN_REQUIRED','WON') and last_message.follow_up_number<c.max_follow_ups and last_message.sent_at<now()-interval '3 days'
 and (target_org is null or c.organization_id=target_org) and not exists(select 1 from public.messages m where m.organization_id=c.organization_id and m.lead_id=cl.lead_id and m.direction='inbound')
 on conflict(organization_id,idempotency_key) do nothing;
 if (now() at time zone 'Europe/Bucharest')::time>='18:30' then
  insert into public.automation_jobs(organization_id,kind,idempotency_key)
  select id,'daily_summary','summary:'||(now() at time zone 'Europe/Bucharest')::date from public.organizations where target_org is null or id=target_org
  on conflict(organization_id,idempotency_key) do nothing;
 end if;
end; $$;

