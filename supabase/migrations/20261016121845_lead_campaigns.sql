-- Named lead pools are independent of the internal per-mailbox send campaigns.
create table public.lead_lists (
 id uuid primary key default gen_random_uuid(),
 organization_id uuid not null references public.organizations(id),
 name text not null check(length(trim(name)) between 2 and 160),
 niche text not null default '',
 created_at timestamptz not null default now(),
 unique(organization_id,id), unique(organization_id,name)
);
alter table public.lead_lists enable row level security;
revoke all on public.lead_lists from public,anon;
grant select,insert,update on public.lead_lists to authenticated;
grant all on public.lead_lists to service_role;
create policy tenant_read on public.lead_lists for select to authenticated using(private.member_of(organization_id));
create policy tenant_insert on public.lead_lists for insert to authenticated with check(private.member_of(organization_id,array['owner','admin','operator']::public.member_role[]));
create policy tenant_update on public.lead_lists for update to authenticated using(private.member_of(organization_id,array['owner','admin','operator']::public.member_role[])) with check(private.member_of(organization_id,array['owner','admin','operator']::public.member_role[]));
alter table public.leads add column lead_list_id uuid;
alter table public.leads add foreign key(organization_id,lead_list_id) references public.lead_lists(organization_id,id);
create index leads_list_idx on public.leads(organization_id,lead_list_id,created_at) where deleted_at is null;
alter table public.gmail_autopilot_settings add column lead_list_id uuid;
alter table public.gmail_autopilot_settings add foreign key(organization_id,lead_list_id) references public.lead_lists(organization_id,id);
create index gmail_autopilot_list_idx on public.gmail_autopilot_settings(organization_id,lead_list_id);

create function private.select_gmail_lead_list(org uuid,target uuid) returns void
language plpgsql security definer set search_path='' as $$
begin
 if not private.member_of(org,array['owner','admin']::public.member_role[]) then raise exception 'Administrator required'; end if;
 perform pg_advisory_xact_lock(hashtext('gmail_autopilot:'||org::text));
 if not exists(select 1 from public.lead_lists where organization_id=org and id=target) then raise exception 'Campaign unavailable'; end if;
 if exists(select 1 from public.gmail_autopilot_settings where organization_id=org and enabled) then raise exception 'Pause Autopilot before switching campaign'; end if;
 if exists(select 1 from public.gmail_autopilot_settings where organization_id=org and lead_list_id=target) then return; end if;
 -- Cancel unsent work from the previous pool before changing the selection.
 update public.messages set status='cancelled' where organization_id=org and direction='outbound' and status in ('draft','approved','queued')
 and campaign_id in(select campaign_id from public.gmail_accounts where organization_id=org);
 update public.campaign_leads set stopped_at=now(),stop_reason='lead_campaign_changed',next_action_at=null where organization_id=org and stopped_at is null
 and campaign_id in(select campaign_id from public.gmail_accounts where organization_id=org);
 update public.automation_jobs set status='cancelled',lock_token=null,locked_until=null where organization_id=org and kind='create_outreach_drafts' and status in ('pending','processing')
 and payload->>'campaign_id' in(select campaign_id::text from public.gmail_accounts where organization_id=org);
 update public.campaigns set status='paused' where organization_id=org and id in(select campaign_id from public.gmail_accounts where organization_id=org);
 update public.gmail_accounts set campaign_id=null,updated_at=now() where organization_id=org;
 insert into public.gmail_autopilot_settings(organization_id,enabled,lead_list_id) values(org,false,target)
 on conflict(organization_id) do update set lead_list_id=target,updated_at=now();
end; $$;
revoke all on function private.select_gmail_lead_list(uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function private.select_gmail_lead_list(uuid,uuid) to authenticated;
create function public.select_gmail_lead_list(org uuid,target uuid) returns void language sql security invoker set search_path='' as $$select private.select_gmail_lead_list(org,target);$$;
revoke all on function public.select_gmail_lead_list(uuid,uuid) from public,anon,service_role;
grant execute on function public.select_gmail_lead_list(uuid,uuid) to authenticated;
-- Settings are server-only. Expose only the authenticated owner/admin wrapper.
grant execute on function private.member_of(uuid,public.member_role[]) to authenticated;

create function private.guard_lead_list_move() returns trigger language plpgsql security invoker set search_path='' as $$
begin
 if old.lead_list_id is distinct from new.lead_list_id and exists(select 1 from public.gmail_autopilot_settings where organization_id=old.organization_id and enabled) then
 raise exception 'Pause Autopilot before moving leads between campaigns'; end if;
 return new;
end; $$;
-- Trigger needs to read the private dispatch setting, never exposes credentials.
-- Run this guard with trusted privileges rather than granting clients table access.
alter function private.guard_lead_list_move() security definer;
revoke all on function private.guard_lead_list_move() from public,anon,authenticated;
create trigger guard_lead_list_move before update of lead_list_id on public.leads for each row execute function private.guard_lead_list_move();

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
   and p.lead_list_id=(select lead_list_id from public.gmail_autopilot_settings where organization_id=org)
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
    insert into public.campaign_leads(organization_id,campaign_id,lead_id) values(org,a.campaign_id,l.id) on conflict(organization_id,campaign_id,lead_id) do update set stopped_at=null,stop_reason=null;
    assignments:=assignments+1;
  end loop;
 end loop;
 insert into public.automation_jobs(organization_id,lead_id,kind,idempotency_key,payload)
 select mailbox_row.organization_id,cl.lead_id,'create_outreach_drafts','initial:'||mailbox_row.campaign_id||':'||cl.lead_id,jsonb_build_object('campaign_id',mailbox_row.campaign_id,'step',0)
 from public.gmail_accounts mailbox_row join public.campaign_leads cl on cl.organization_id=org and cl.campaign_id=mailbox_row.campaign_id
 join public.campaigns c on c.organization_id=org and c.id=mailbox_row.campaign_id
 join public.leads p on p.organization_id=org and p.id=cl.lead_id
 where mailbox_row.organization_id=org and mailbox_row.status='connected' and c.status='active' and cl.stopped_at is null and not p.do_not_contact and p.status in ('NEW','READY_FOR_OUTREACH')
 and p.lead_list_id=(select lead_list_id from public.gmail_autopilot_settings where organization_id=org)
 and not exists(select 1 from public.messages m where m.organization_id=org and m.campaign_id=c.id and m.lead_id=p.id and m.direction='outbound' and m.follow_up_number=0)
 on conflict(organization_id,idempotency_key) do update set status='pending',attempts=0,lock_token=null,locked_until=null where public.automation_jobs.status='cancelled';
 return assignments;
end; $$;

-- Selection and activation share one transaction and advisory lock.
create function public.start_gmail_lead_list(org uuid,target uuid,initial_template text) returns integer
language plpgsql security invoker set search_path='' as $$
begin
 perform public.select_gmail_lead_list(org,target);
 return public.set_gmail_autopilot(org,true,initial_template);
end; $$;
revoke all on function public.start_gmail_lead_list(uuid,uuid,text) from public,anon,service_role;
grant execute on function public.start_gmail_lead_list(uuid,uuid,text) to authenticated;
