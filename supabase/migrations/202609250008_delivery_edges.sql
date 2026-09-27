create or replace function private.audit_change() returns trigger language plpgsql security definer set search_path='' as $$
declare record_data jsonb; previous_data jsonb;
begin
 record_data=case when TG_OP='DELETE' then to_jsonb(old) else to_jsonb(new) end;
 previous_data=case when TG_OP='INSERT' then '{}'::jsonb else to_jsonb(old) end;
 insert into public.activities(organization_id,actor_id,action,entity_table,entity_id,lead_id,details)
 values((record_data->>'organization_id')::uuid,auth.uid(),lower(TG_OP),TG_TABLE_NAME,(record_data->>'id')::uuid,
 case when TG_TABLE_NAME='leads' and TG_OP<>'DELETE' then (record_data->>'id')::uuid else null end,jsonb_build_object('source','database','from_status',previous_data->>'status','to_status',record_data->>'status'));
 return case when TG_OP='DELETE' then old else new end;
end; $$;

create or replace function public.reserve_outbound_message(message_id uuid) returns setof public.messages language plpgsql security definer set search_path='' as $$
declare m public.messages; c public.campaigns; l public.leads; local_now timestamp; sent_count integer;
begin
 select * into m from public.messages where id=message_id for update;
 if not found or m.direction<>'outbound' or m.status not in ('approved','queued','sending') then return; end if;
 select * into l from public.leads where id=m.lead_id and organization_id=m.organization_id for update;
 if l.do_not_contact or l.status in ('DO_NOT_CONTACT','LOST','HUMAN_REQUIRED') or exists(select 1 from public.suppression_list s where s.organization_id=m.organization_id and (s.lead_id=m.lead_id or s.identifier=lower(trim(l.email)))) then return; end if;
 select * into c from public.campaigns where id=m.campaign_id and organization_id=m.organization_id for update;
 if not found or c.status<>'active' or c.activated_by is null then return; end if;
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
