-- A narrow private definer is needed to change the server-only mailbox settings
-- and campaigns in one transaction. It exposes no credentials and checks the
-- signed-in administrator independently of the HTTP endpoint.
create function private.set_gmail_autopilot(org uuid,should_run boolean,initial_template text) returns integer
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
   values(org,'Autopilot · '||a.email,a.email,'automatic','active',a.daily_cap,0,initial_template,'09:30','16:30',true,'{"gmail_autopilot":true}') returning id into c_id;
  else
   update public.campaigns set sender_identity=a.email,mode='automatic',status='active',daily_cap=a.daily_cap,max_follow_ups=0,first_message=initial_template,window_start='09:30',window_end='16:30',weekdays_only=true
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

create function public.set_gmail_autopilot(org uuid,should_run boolean,initial_template text) returns integer
language sql security invoker set search_path='' as $$select private.set_gmail_autopilot(org,should_run,initial_template);$$;
revoke all on function public.set_gmail_autopilot(uuid,boolean,text) from public,anon,authenticated,service_role;
grant execute on function public.set_gmail_autopilot(uuid,boolean,text) to authenticated;

-- Existing CSV prospects may already have unsent drafts in an inactive
-- campaign. They remain eligible; preserve those drafts as cancelled history
-- and prepare one new initial message in the selected Gmail campaign.
create or replace function public.schedule_gmail_autopilot(org uuid) returns integer
language plpgsql security invoker set search_path='' as $$
declare a public.gmail_accounts; l public.leads; slots integer; assignments integer:=0;
begin
 perform pg_advisory_xact_lock(hashtext('gmail_autopilot:'||org::text));
 if not exists(select 1 from public.gmail_autopilot_settings where organization_id=org and enabled) then return 0; end if;
 for a in select * from public.gmail_accounts where organization_id=org and status='connected' and campaign_id is not null order by email loop
  if not exists(select 1 from public.campaigns where organization_id=org and id=a.campaign_id and status='active' and activated_by is not null) then continue; end if;
  slots:=a.daily_cap-(select count(*) from public.gmail_delivery_attempts where organization_id=org and account_id=a.id
   and created_at>=((now() at time zone 'Europe/Bucharest')::date::timestamp at time zone 'Europe/Bucharest'))
   -(select count(*) from public.campaign_leads cl join public.leads p on p.organization_id=org and p.id=cl.lead_id
     where cl.organization_id=org and cl.campaign_id=a.campaign_id and cl.stopped_at is null and not p.do_not_contact and p.status not in ('HUMAN_REQUIRED','LOST','DO_NOT_CONTACT','WON')
     and not exists(select 1 from public.messages m where m.organization_id=org and m.campaign_id=a.campaign_id and m.lead_id=cl.lead_id and m.direction='outbound' and m.status in ('sent','delivered','opened','sending','failed','bounced')));
  for l in select * from public.leads p where p.organization_id=org and p.deleted_at is null and not p.do_not_contact
   and p.status in ('NEW','READY_FOR_OUTREACH') and p.email ~* '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
   and p.normalized_email is not null and p.source !~* '(demo|test|evaluare|synthetic)'
   and p.email !~* '@(example\.(com|org|net)|website\.com|test\.com)$' and p.email !~* '\.(invalid|test|example|localhost)$'
   and not exists(select 1 from public.suppression_list s where s.organization_id=org and (s.lead_id=p.id or s.identifier=p.normalized_email))
   and not exists(select 1 from public.messages m where m.organization_id=org and m.lead_id=p.id and (m.direction='inbound' or m.status in ('sent','delivered','opened','sending','failed','bounced')))
   and not exists(select 1 from public.campaign_leads cl join public.campaigns c on c.organization_id=org and c.id=cl.campaign_id where cl.organization_id=org and cl.lead_id=p.id and cl.stopped_at is null and c.status='active')
   order by p.created_at,p.id limit greatest(slots,0) for update of p skip locked loop
    update public.campaign_leads set stopped_at=now(),stop_reason='moved_to_gmail_autopilot',next_action_at=null where organization_id=org and lead_id=l.id and campaign_id<>a.campaign_id and stopped_at is null;
    update public.messages set status='cancelled' where organization_id=org and lead_id=l.id and direction='outbound' and status in ('draft','approved','queued') and campaign_id is distinct from a.campaign_id;
    update public.automation_jobs set status='cancelled',lock_token=null,locked_until=null where organization_id=org and lead_id=l.id and kind='enrich_new_leads' and status='pending';
    insert into public.campaign_leads(organization_id,campaign_id,lead_id) values(org,a.campaign_id,l.id) on conflict do nothing;
    assignments:=assignments+1;
  end loop;
 end loop;
 insert into public.automation_jobs(organization_id,lead_id,kind,idempotency_key,payload)
 select mailbox_row.organization_id,cl.lead_id,'create_outreach_drafts','initial:'||mailbox_row.campaign_id||':'||cl.lead_id,jsonb_build_object('campaign_id',mailbox_row.campaign_id,'step',0)
 from public.gmail_accounts mailbox_row join public.campaign_leads cl on cl.organization_id=org and cl.campaign_id=mailbox_row.campaign_id
 join public.campaigns c on c.organization_id=org and c.id=mailbox_row.campaign_id
 join public.leads p on p.organization_id=org and p.id=cl.lead_id
 where mailbox_row.organization_id=org and mailbox_row.status='connected' and c.status='active' and cl.stopped_at is null and not p.do_not_contact and p.status in ('NEW','READY_FOR_OUTREACH')
 and not exists(select 1 from public.messages m where m.organization_id=org and m.campaign_id=c.id and m.lead_id=p.id and m.direction='outbound' and m.follow_up_number=0)
 on conflict(organization_id,idempotency_key) do nothing;
 return assignments;
end; $$;
