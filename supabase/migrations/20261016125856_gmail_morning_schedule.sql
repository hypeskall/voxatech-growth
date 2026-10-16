-- B2B morning baseline, Europe/Bucharest (automatic DST). Both reservation
-- and the final durable Gmail claim already enforce these campaign fields.
-- Saturday and Sunday are skipped. Caps and pacing remain unchanged.
-- Evidence: https://belkins.io/blog/best-time-to-send-email (2026 study).
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
   values(org,'Autopilot · '||a.email,a.email,'automatic','active',a.daily_cap,0,initial_template,'08:00','12:00',true,'{"gmail_autopilot":true}') returning id into c_id;
  else
   update public.campaigns set sender_identity=a.email,mode='automatic',status='active',daily_cap=a.daily_cap,max_follow_ups=0,first_message=initial_template,window_start='08:00',window_end='12:00',weekdays_only=true
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
set window_start='08:00',window_end='12:00',weekdays_only=true
where c.target_filters @> '{"gmail_autopilot":true}'::jsonb
 or exists(select 1 from public.gmail_accounts a where a.organization_id=c.organization_id and a.campaign_id=c.id);
