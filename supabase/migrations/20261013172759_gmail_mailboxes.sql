-- Credentials and dispatch records are accessible only to the trusted server.
create table public.gmail_accounts (
 id uuid primary key default gen_random_uuid(),
 organization_id uuid not null references public.organizations(id),
 email text not null check(email=lower(trim(email))),
 google_subject text not null,
 encrypted_refresh_token text,
 status text not null default 'connected' check(status in ('connected','paused','reconnect_required','disconnected')),
 daily_cap integer not null default 5 check(daily_cap between 1 and 10),
 next_send_at timestamptz,
 campaign_id uuid,
 last_synced_at timestamptz,
 last_error text,
 last_test_at timestamptz,
 connected_by uuid references public.profiles(id),
 last_verified_at timestamptz not null default now(),
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 unique(organization_id,email), unique(organization_id,google_subject), unique(organization_id,id),
 check(status<>'connected' or encrypted_refresh_token is not null),
 foreign key(organization_id,campaign_id) references public.campaigns(organization_id,id)
);
create index gmail_accounts_actor_idx on public.gmail_accounts(connected_by);
create index gmail_accounts_campaign_idx on public.gmail_accounts(organization_id,campaign_id);
alter table public.gmail_accounts enable row level security;
revoke all on public.gmail_accounts from public,anon,authenticated;
grant select,insert,update,delete on public.gmail_accounts to service_role;

create table public.gmail_delivery_attempts (
 id uuid primary key default gen_random_uuid(),
 organization_id uuid not null,
 account_id uuid not null,
 delivery_key text not null,
 status text not null default 'sending' check(status in ('sending','sent','failed','unknown')),
 provider_message_id text,
 created_at timestamptz not null default now(),
 unique(organization_id,delivery_key),
 foreign key(organization_id,account_id) references public.gmail_accounts(organization_id,id)
);
create index gmail_delivery_account_day_idx on public.gmail_delivery_attempts(organization_id,account_id,created_at);
alter table public.gmail_delivery_attempts enable row level security;
revoke all on public.gmail_delivery_attempts from public,anon,authenticated;
grant select,insert,update on public.gmail_delivery_attempts to service_role;

-- Serialize all campaigns and internal tests for one mailbox. A reserved request
-- is never automatically retried: Gmail messages.send has no idempotency key.
create function public.claim_gmail_delivery(org uuid,mailbox uuid,request_key text) returns boolean
language plpgsql security invoker set search_path='' as $$
declare a public.gmail_accounts;
begin
 select * into a from public.gmail_accounts where organization_id=org and id=mailbox for update;
 if not found or a.status<>'connected' or a.encrypted_refresh_token is null then
  raise exception 'Gmail necesită reconectare.';
 end if;
 if exists(select 1 from public.gmail_delivery_attempts where organization_id=org and delivery_key=request_key) then return false; end if;
 if a.campaign_id is not null and exists(select 1 from public.messages m where m.organization_id=org and m.id::text=request_key and m.campaign_id=a.campaign_id)
  and not exists(select 1 from public.gmail_autopilot_settings where organization_id=org and enabled) then
  raise exception 'GMAIL_DEFERRED: Autopilot este în pauză.';
 end if;
 if a.next_send_at>now() then raise exception 'GMAIL_DEFERRED: Următoarea trimitere este programată mai târziu.'; end if;
 if (select count(*) from public.gmail_delivery_attempts where organization_id=org and account_id=mailbox
     and created_at>=((now() at time zone 'Europe/Bucharest')::date::timestamp at time zone 'Europe/Bucharest'))>=a.daily_cap then
  raise exception 'GMAIL_DEFERRED: Limita zilnică a căsuței a fost atinsă.';
 end if;
 insert into public.gmail_delivery_attempts(organization_id,account_id,delivery_key) values(org,mailbox,request_key)
 on conflict(organization_id,delivery_key) do nothing;
 if not found then return false; end if;
 update public.gmail_accounts set next_send_at=now()+interval '10 minutes' where id=mailbox and organization_id=org;
 return true;
end; $$;
revoke all on function public.claim_gmail_delivery(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.claim_gmail_delivery(uuid,uuid,text) to service_role;

create table public.gmail_threads (
 id uuid primary key default gen_random_uuid(), organization_id uuid not null,
 account_id uuid not null, thread_id text not null, lead_id uuid not null, parent_id uuid not null,
 last_synced_at timestamptz, created_at timestamptz not null default now(),
 unique(organization_id,account_id,thread_id),
 foreign key(organization_id,account_id) references public.gmail_accounts(organization_id,id),
 foreign key(organization_id,parent_id,lead_id) references public.messages(organization_id,id,lead_id)
);
create index gmail_threads_poll_idx on public.gmail_threads(organization_id,account_id,last_synced_at);
create index gmail_threads_parent_idx on public.gmail_threads(organization_id,parent_id,lead_id);
alter table public.gmail_threads enable row level security;
revoke all on public.gmail_threads from public,anon,authenticated;
grant select,insert,update on public.gmail_threads to service_role;

create table public.gmail_autopilot_settings (
 organization_id uuid primary key references public.organizations(id), enabled boolean not null default false,
 updated_at timestamptz not null default now()
);
alter table public.gmail_autopilot_settings enable row level security;
revoke all on public.gmail_autopilot_settings from public,anon,authenticated;
grant select,insert,update on public.gmail_autopilot_settings to service_role;

-- Scheduling is a trusted worker action; organization serialization prevents two
-- wakeups assigning the same prospect to separate mailboxes.
create function public.schedule_gmail_autopilot(org uuid) returns integer
language plpgsql security invoker set search_path='' as $$
declare a public.gmail_accounts; l public.leads; slots integer; assignments integer:=0;
begin
 perform pg_advisory_xact_lock(hashtext('gmail_autopilot:'||org::text));
 if not exists(select 1 from public.gmail_autopilot_settings where organization_id=org and enabled) then return 0; end if;
 for a in select * from public.gmail_accounts where organization_id=org and status='connected' and campaign_id is not null order by email loop
  if not exists(select 1 from public.campaigns where organization_id=org and id=a.campaign_id and status='active' and activated_by is not null) then continue; end if;
  slots:=a.daily_cap-(select count(*) from public.gmail_delivery_attempts where organization_id=org and account_id=a.id
   and created_at>=((now() at time zone 'Europe/Bucharest')::date::timestamp at time zone 'Europe/Bucharest'))
   -(select count(*) from public.campaign_leads cl where cl.organization_id=org and cl.campaign_id=a.campaign_id and cl.stopped_at is null
     and not exists(select 1 from public.messages m where m.organization_id=org and m.campaign_id=a.campaign_id and m.lead_id=cl.lead_id and m.direction='outbound' and m.status in ('sent','delivered','opened','sending','failed','bounced')));
  for l in select * from public.leads p where p.organization_id=org and p.deleted_at is null and not p.do_not_contact
   and p.status in ('NEW','READY_FOR_OUTREACH') and p.email ~* '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
   and p.normalized_email is not null and p.source !~* '(demo|test|evaluare|synthetic)'
   and p.email !~* '@(example\.(com|org|net|invalid)|website\.com|test\.com)$'
   and not exists(select 1 from public.suppression_list s where s.organization_id=org and (s.lead_id=p.id or s.identifier=p.normalized_email))
   and not exists(select 1 from public.messages m where m.organization_id=org and m.lead_id=p.id and m.direction in ('inbound','outbound'))
   and not exists(select 1 from public.campaign_leads cl where cl.organization_id=org and cl.lead_id=p.id and cl.stopped_at is null)
   and not exists(select 1 from public.campaign_leads cl join public.leads prior on prior.organization_id=org and prior.id=cl.lead_id where cl.organization_id=org and prior.normalized_email=p.normalized_email)
   order by p.created_at,p.id limit greatest(slots,0) for update of p skip locked loop
    insert into public.campaign_leads(organization_id,campaign_id,lead_id) values(org,a.campaign_id,l.id) on conflict do nothing;
    assignments:=assignments+1;
  end loop;
 end loop;
 return assignments;
end; $$;
revoke all on function public.schedule_gmail_autopilot(uuid) from public,anon,authenticated;
grant execute on function public.schedule_gmail_autopilot(uuid) to service_role;
