create function private.campaign_matches(c public.campaigns,l public.leads) returns boolean language sql immutable set search_path='' as $$
select (c.niche is null or c.niche='' or coalesce(lower(c.niche)=lower(l.niche),false))
 and (cardinality(c.cities)=0 or coalesce(lower(l.city)=any(select lower(city) from unnest(c.cities) city),false))
 and coalesce(l.lead_score,0)>=coalesce(nullif(c.target_filters->>'min_score',''),'0')::integer
 and (coalesce(c.target_filters->>'source','')='' or c.target_filters->>'source'=l.source);
$$;
revoke all on function private.campaign_matches(public.campaigns,public.leads) from public,anon;
create or replace function public.reserve_outbound_message(message_id uuid) returns setof public.messages language plpgsql security definer set search_path='' as $$
declare m public.messages; c public.campaigns; l public.leads; local_now timestamp; sent_count integer;
begin
 select * into m from public.messages where id=message_id for update;
 if not found or m.direction<>'outbound' or m.status not in ('approved','queued','sending') then return; end if;
 select * into l from public.leads where id=m.lead_id and organization_id=m.organization_id for update;
 if l.do_not_contact or l.status in ('DO_NOT_CONTACT','LOST','HUMAN_REQUIRED') or exists(select 1 from public.suppression_list s where s.organization_id=m.organization_id and (s.lead_id=m.lead_id or s.identifier=lower(trim(l.email)))) then return; end if;
 select * into c from public.campaigns where id=m.campaign_id and organization_id=m.organization_id for update;
 if not found or c.status<>'active' or c.activated_by is null then return; end if;
 if coalesce(m.metadata->>'transactional_onboarding','false')<>'true' and not private.campaign_matches(c,l) then return; end if;
 if m.follow_up_number>c.max_follow_ups then return; end if;
 if m.follow_up_number is not null and exists(select 1 from public.messages r where r.organization_id=m.organization_id and r.lead_id=m.lead_id and r.direction='inbound') then return; end if;
 if c.mode='approval_required' and m.approved_by is null and coalesce(m.metadata->>'transactional_onboarding','false')<>'true' then return; end if;
 if m.status='sending' then
  if m.reserved_at>now()-interval '23 hours' then return next m; end if;
  return;
 end if;
 local_now=now() at time zone 'Europe/Bucharest';
 if (c.weekdays_only and extract(isodow from local_now)>5) or local_now::time<c.window_start or local_now::time>=c.window_end or c.next_send_at>now() then return; end if;
 select count(*) into sent_count from public.messages where campaign_id=c.id and (reserved_at at time zone 'Europe/Bucharest')::date=local_now::date;
 if sent_count>=c.daily_cap then return; end if;
 update public.campaigns set next_send_at=now()+make_interval(secs=>60+floor(random()*120)::integer) where id=c.id;
 update public.messages set status='sending',reserved_at=now() where id=m.id returning * into m;
 return next m;
end; $$;

create or replace function public.schedule_due_jobs(target_org uuid default null,delivery_mode text default 'log') returns void language plpgsql security definer set search_path='' as $$
begin
 insert into public.automation_jobs(organization_id,lead_id,kind,idempotency_key,payload)
 select m.organization_id,m.lead_id,'send_due_messages','send:'||delivery_mode||':'||m.id,jsonb_build_object('message_id',m.id)
 from public.messages m join public.leads l on l.id=m.lead_id
 where m.direction='outbound' and m.status in ('approved','queued','sending') and not l.do_not_contact and l.status not in ('LOST','HUMAN_REQUIRED') and (target_org is null or m.organization_id=target_org)
 on conflict(organization_id,idempotency_key) do nothing;
 insert into public.automation_jobs(organization_id,lead_id,kind,idempotency_key,payload)
 select c.organization_id,cl.lead_id,'create_outreach_drafts','initial:'||c.id||':'||cl.lead_id,jsonb_build_object('campaign_id',c.id,'step',0)
 from public.campaigns c join public.campaign_leads cl on cl.campaign_id=c.id join public.leads l on l.id=cl.lead_id
 where c.status='active' and private.campaign_matches(c,l) and cl.stopped_at is null and not l.do_not_contact and l.status not in ('LOST','HUMAN_REQUIRED','WON') and (target_org is null or c.organization_id=target_org)
 and not exists(select 1 from public.messages m where m.campaign_id=c.id and m.lead_id=cl.lead_id and m.follow_up_number=0)
 on conflict(organization_id,idempotency_key) do nothing;
 insert into public.automation_jobs(organization_id,lead_id,kind,idempotency_key,payload)
 select c.organization_id,cl.lead_id,'process_follow_ups','follow:'||c.id||':'||cl.lead_id||':'||(last_message.follow_up_number+1),jsonb_build_object('campaign_id',c.id,'step',last_message.follow_up_number+1)
 from public.campaigns c join public.campaign_leads cl on cl.campaign_id=c.id join public.leads l on l.id=cl.lead_id
 cross join lateral(select m.follow_up_number,m.sent_at from public.messages m where m.campaign_id=c.id and m.lead_id=cl.lead_id and m.sent_at is not null and m.follow_up_number is not null order by m.follow_up_number desc limit 1) last_message
 where c.status='active' and private.campaign_matches(c,l) and cl.stopped_at is null and not l.do_not_contact and l.status not in ('LOST','HUMAN_REQUIRED','WON') and last_message.follow_up_number<c.max_follow_ups and last_message.sent_at<now()-interval '3 days'
 and (target_org is null or c.organization_id=target_org)
 and not exists(select 1 from public.messages m where m.lead_id=cl.lead_id and m.direction='inbound')
 on conflict(organization_id,idempotency_key) do nothing;
 if (now() at time zone 'Europe/Bucharest')::time>='18:30' then
 insert into public.automation_jobs(organization_id,kind,idempotency_key)
 select id,'daily_summary','summary:'||(now() at time zone 'Europe/Bucharest')::date from public.organizations where target_org is null or id=target_org
 on conflict(organization_id,idempotency_key) do nothing;
 end if;
end; $$;
revoke all on function public.schedule_due_jobs(uuid,text) from public,anon,authenticated;
grant execute on function public.schedule_due_jobs(uuid,text) to service_role;
