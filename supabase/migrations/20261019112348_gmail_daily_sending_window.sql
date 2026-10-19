-- Allow ten daily messages per mailbox across the full working day.
create or replace function private.set_gmail_autopilot(org uuid,should_run boolean,initial_template text) returns integer
language plpgsql security definer set search_path='' as $$
declare a public.gmail_accounts; c_id uuid; connected_count integer:=0;
begin
 if auth.uid() is null or not private.member_of(org,array['owner','admin']::public.member_role[]) then
  raise exception 'Administrator necessary' using errcode='42501';
 end if;
 if length(initial_template)>10000 then raise exception 'Template too long'; end if;
 perform pg_advisory_xact_lock(hashtext('gmail_autopilot:'||org::text));
 if should_run and not exists(select 1 from public.gmail_accounts where organization_id=org and status='connected') then
  raise exception 'Connect a Gmail mailbox first';
 end if;
 if should_run and exists(select 1 from public.gmail_accounts where organization_id=org and status='connected' and last_test_at is null) then
  raise exception 'An internal test is required for each mailbox';
 end if;
 insert into public.gmail_autopilot_settings(organization_id,enabled) values(org,false)
 on conflict(organization_id) do update set enabled=false,updated_at=now();
 for a in select * from public.gmail_accounts where organization_id=org order by email loop
  if not should_run or a.status<>'connected' then
   if a.campaign_id is not null then update public.campaigns set status='paused' where organization_id=org and id=a.campaign_id; end if;
   continue;
  end if;
  c_id:=a.campaign_id;
  if c_id is null then
   insert into public.campaigns(organization_id,name,sender_identity,mode,status,daily_cap,max_follow_ups,first_message,window_start,window_end,weekdays_only,target_filters)
   values(org,'Autopilot · '||a.email,a.email,'automatic','active',a.daily_cap,0,initial_template,'08:00','18:00',true,'{"gmail_autopilot":true}') returning id into c_id;
  else
   update public.campaigns set sender_identity=a.email,mode='automatic',status='active',daily_cap=a.daily_cap,max_follow_ups=0,first_message=initial_template,window_start='08:00',window_end='18:00',weekdays_only=true
   where organization_id=org and id=c_id;
  end if;
  update public.gmail_accounts set campaign_id=c_id,updated_at=now() where organization_id=org and id=a.id;
  connected_count:=connected_count+1;
 end loop;
 update public.gmail_autopilot_settings set enabled=should_run,updated_at=now() where organization_id=org;
 return connected_count;
end; $$;
revoke all on function private.set_gmail_autopilot(uuid,boolean,text) from public,anon,authenticated,service_role;
grant execute on function private.set_gmail_autopilot(uuid,boolean,text) to authenticated;


update public.campaigns c
set window_start='08:00',window_end='18:00',weekdays_only=true
where c.target_filters @> '{"gmail_autopilot":true}'::jsonb
 or exists(select 1 from public.gmail_accounts a where a.organization_id=c.organization_id and a.campaign_id=c.id);

-- Bring initial messages incorrectly deferred to tomorrow back into the open
-- window. Durable attempts, replies, opt-outs and manual drafts are excluded.
update public.automation_jobs j
set next_action_at=least(j.next_action_at,private.delivery_retry_at(
 greatest(now(),a.next_send_at,c.next_send_at),c.window_start,c.window_end,c.weekdays_only))
from public.messages m
join public.campaigns c on c.organization_id=m.organization_id and c.id=m.campaign_id
join public.gmail_accounts a on a.organization_id=c.organization_id and a.campaign_id=c.id
join public.gmail_autopilot_settings cfg on cfg.organization_id=c.organization_id and cfg.enabled
join public.leads l on l.organization_id=m.organization_id and l.id=m.lead_id
join public.campaign_leads cl on cl.organization_id=m.organization_id and cl.campaign_id=m.campaign_id and cl.lead_id=m.lead_id
where j.organization_id=m.organization_id and j.payload->>'message_id'=m.id::text
 and j.kind='send_due_messages' and j.status='pending' and j.next_action_at>now()
 and m.direction='outbound' and m.follow_up_number=0 and m.in_reply_to is null
 and m.status in ('approved','queued') and c.status='active' and a.status='connected'
 and l.deleted_at is null and not l.do_not_contact and l.status not in ('LOST','WON','DO_NOT_CONTACT','HUMAN_REQUIRED')
 and l.lead_list_id=cfg.lead_list_id and cl.stopped_at is null
 and not exists(select 1 from public.messages r where r.organization_id=m.organization_id and r.lead_id=m.lead_id and r.direction='inbound')
 and not exists(select 1 from public.suppression_list s where s.organization_id=m.organization_id and (s.lead_id=l.id or s.identifier=l.normalized_email))
 and not exists(select 1 from public.gmail_delivery_attempts d where d.organization_id=m.organization_id and d.delivery_key=m.id::text)
 and (select count(*) from public.gmail_delivery_attempts d where d.organization_id=a.organization_id and d.account_id=a.id
      and d.created_at>=((now() at time zone 'Europe/Bucharest')::date::timestamp at time zone 'Europe/Bucharest'))<a.daily_cap;
