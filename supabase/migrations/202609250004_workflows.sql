alter table public.leads add column enriched_at timestamptz, add column verified_facts jsonb not null default '{}';
alter table public.campaigns add column next_send_at timestamptz;
alter table public.messages add column reserved_at timestamptz, add column unsubscribe_token uuid not null default gen_random_uuid() unique, add column reply_token uuid not null default gen_random_uuid() unique;
alter table public.demos add column audio_segments jsonb not null default '[]', add column viewed_at timestamptz, add column listened_at timestamptz;
alter table public.onboarding_records add column share_token uuid not null default gen_random_uuid() unique, add column expires_at timestamptz not null default now()+interval '30 days';
alter table public.knowledge_base_documents add column deleted_at timestamptz;
create unique index tasks_attention_unique on public.tasks(organization_id,lead_id) where status in ('open','in_progress') and title='Intervenție umană necesară';
create unique index demo_per_request on public.demos(organization_id,lead_id,idempotency_key);
create unique index message_campaign_step on public.messages(organization_id,campaign_id,lead_id,follow_up_number) where direction='outbound' and follow_up_number is not null;

create function public.reserve_outbound_message(message_id uuid) returns setof public.messages language plpgsql security definer set search_path='' as $$
declare m public.messages; c public.campaigns; l public.leads; local_now timestamp; sent_count integer;
begin
 select * into m from public.messages where id=message_id for update;
 if not found or m.direction<>'outbound' or m.status not in ('approved','queued','sending') then return; end if;
 select * into l from public.leads where id=m.lead_id and organization_id=m.organization_id for update;
 if l.do_not_contact or l.status in ('DO_NOT_CONTACT','LOST','HUMAN_REQUIRED') or exists(select 1 from public.suppression_list s where s.organization_id=m.organization_id and (s.lead_id=m.lead_id or s.identifier=lower(trim(l.email)))) then return; end if;
 select * into c from public.campaigns where id=m.campaign_id and organization_id=m.organization_id for update;
 if not found or c.status<>'active' or c.activated_by is null then return; end if;
 if m.follow_up_number>c.max_follow_ups then return; end if;
 if m.follow_up_number>0 and exists(select 1 from public.messages r where r.organization_id=m.organization_id and r.lead_id=m.lead_id and r.direction='inbound') then return; end if;
 if c.mode='approval_required' and m.approved_by is null then return; end if;
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
revoke all on function public.reserve_outbound_message(uuid) from public,anon,authenticated;
grant execute on function public.reserve_outbound_message(uuid) to service_role;

create function public.suppress_lead(org uuid, target uuid, reason_text text) returns void language plpgsql security definer set search_path='' as $$
declare l public.leads;
begin
 select * into l from public.leads where organization_id=org and id=target for update;
 if not found then raise exception 'Lead not found'; end if;
 insert into public.suppression_list(organization_id,lead_id,channel,identifier,reason)
 values(org,target,'all',coalesce(nullif(lower(trim(l.email)),''),target::text),reason_text)
 on conflict(organization_id,channel,identifier) do nothing;
 update public.leads set status='DO_NOT_CONTACT',do_not_contact=true,next_action_at=null where id=target;
end; $$;
revoke all on function public.suppress_lead(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.suppress_lead(uuid,uuid,text) to service_role;

create function public.apply_payment(org uuid, target uuid, reference text, amount numeric, currency_code text) returns uuid language plpgsql security definer set search_path='' as $$
declare onboarding_id uuid;
begin
 perform 1 from public.leads where organization_id=org and id=target for update;
 if not found then raise exception 'Lead not found'; end if;
 insert into public.onboarding_records(organization_id,lead_id,payment_provider,payment_reference,amount_paid,currency)
 values(org,target,'stripe',reference,amount,currency_code)
 on conflict(organization_id,lead_id) do update set payment_reference=excluded.payment_reference,amount_paid=excluded.amount_paid,currency=excluded.currency
 returning id into onboarding_id;
 update public.leads set status=case when do_not_contact then status else 'WON' end,revenue_won=amount,currency=currency_code where id=target;
 insert into public.notifications(organization_id,title,body,idempotency_key) values(org,'Plată confirmată','Un client a plătit. Formularul de configurare este pregătit.','payment:'||reference) on conflict do nothing;
 return onboarding_id;
end; $$;
revoke all on function public.apply_payment(uuid,uuid,text,numeric,text) from public,anon,authenticated;
grant execute on function public.apply_payment(uuid,uuid,text,numeric,text) to service_role;

-- Tenant identity and primary keys cannot be moved by editing an existing record.
create function private.immutable_tenant() returns trigger language plpgsql set search_path='' as $$
begin
 if new.organization_id<>old.organization_id or new.id<>old.id then raise exception 'Immutable tenant identity'; end if; return new;
end; $$;
do $$ declare t text; begin
 foreach t in array array['leads','lead_contacts','campaigns','campaign_leads','conversations','messages','activities','tasks','demos','knowledge_base_documents','knowledge_base_versions','automation_jobs','suppression_list','integrations','settings','onboarding_records','notifications','webhook_events','organization_members'] loop
 execute format('create trigger immutable_tenant before update on public.%I for each row execute function private.immutable_tenant()',t);
 end loop;
end $$;
revoke execute on function private.immutable_tenant() from public,anon;
