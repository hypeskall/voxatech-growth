-- Voxa Growth. Organization membership is provisioned by trusted administrators only.
create schema if not exists private;
revoke all on schema private from public;
grant usage on schema private to authenticated, service_role;
create type public.member_role as enum ('owner','admin','operator','viewer');
create type public.lead_status as enum ('NEW','ENRICHING','READY_FOR_OUTREACH','CONTACTED','FOLLOW_UP_1','FOLLOW_UP_2','REPLIED','QUALIFIED','DEMO_GENERATING','DEMO_SENT','TRIAL','CHECKOUT_SENT','WON','LOST','HUMAN_REQUIRED','DO_NOT_CONTACT');
create table public.organizations (
 id uuid primary key default gen_random_uuid(), name text not null, slug text not null unique,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table public.profiles (
 id uuid primary key references auth.users(id) on delete cascade,
 full_name text not null default '', created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table public.organization_members (
 id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id),
 user_id uuid not null references public.profiles(id), role public.member_role not null default 'viewer',
 created_at timestamptz not null default now(), unique (organization_id,user_id)
);
create index organization_members_user_idx on public.organization_members(user_id, organization_id);
create function private.member_of(org uuid, allowed public.member_role[] default array['owner','admin','operator','viewer']::public.member_role[])
returns boolean language sql stable security definer set search_path = '' as $$
 select exists(select 1 from public.organization_members m where m.organization_id=org and m.user_id=(select auth.uid()) and m.role=any(allowed));
$$;
revoke all on function private.member_of(uuid,public.member_role[]) from public;
grant execute on function private.member_of(uuid,public.member_role[]) to authenticated, service_role;
create function private.on_auth_user_created() returns trigger language plpgsql security definer set search_path = '' as $$
begin
 insert into public.profiles(id,full_name) values(new.id,coalesce(new.raw_user_meta_data->>'full_name','')) on conflict(id) do nothing;
 return new;
end; $$;
create trigger voxa_profile_created after insert on auth.users for each row execute function private.on_auth_user_created();
insert into public.profiles(id,full_name) select id,coalesce(raw_user_meta_data->>'full_name','') from auth.users on conflict(id) do nothing;

create table public.leads (
 id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id),
 company_name text not null check(length(trim(company_name))>0), niche text, city text, country text not null default 'RO', website text,
 email text, phone text, contact_name text, source text not null default 'manual', services jsonb not null default '[]', opening_hours jsonb,
 google_rating numeric(2,1) check(google_rating between 0 and 5), review_count integer check(review_count>=0),
 lead_score integer check(lead_score between 0 and 100), score_reasons jsonb not null default '[]',
 lead_temperature text check(lead_temperature in ('cold','warm','hot')), personalization_fact text, website_summary text,
 status public.lead_status not null default 'NEW', owner_id uuid, last_contact_at timestamptz, next_action_at timestamptz,
 do_not_contact boolean not null default false, notes text not null default '', conversation_summary text, revenue_won numeric(12,2) not null default 0 check(revenue_won>=0), currency text not null default 'RON',
 normalized_email text generated always as (nullif(lower(trim(email)),'')) stored,
 normalized_phone text generated always as (nullif(regexp_replace(phone,'[^0-9+]','','g'),'')) stored,
 normalized_website text generated always as (nullif(lower(regexp_replace(regexp_replace(trim(website),'^https?://(www\.)?','','i'),'[/?#].*$','')),'')) stored,
 normalized_company_city text generated always as (lower(trim(company_name))||'|'||lower(trim(coalesce(city,'')))) stored,
 foreign key(organization_id,owner_id) references public.organization_members(organization_id,user_id),
 check(not do_not_contact or status='DO_NOT_CONTACT'),
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique(organization_id,id)
);
create index leads_org_idx on public.leads(organization_id);

create table public.lead_contacts (
 id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id),
 lead_id uuid not null, name text, email text, phone text, position text, is_primary boolean not null default false,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique(organization_id,id)
);
create index lead_contacts_org_idx on public.lead_contacts(organization_id);

create table public.campaigns (
 id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id),
 name text not null, niche text, cities text[] not null default '{}', target_filters jsonb not null default '{}',
 sender_identity text, tone text not null default 'profesional', offer text, daily_cap integer not null default 25 check(daily_cap between 1 and 1000),
 window_start time not null default '09:30', window_end time not null default '16:30', timezone text not null default 'Europe/Bucharest' check(timezone='Europe/Bucharest'),
 weekdays_only boolean not null default true, max_follow_ups integer not null default 2 check(max_follow_ups between 0 and 2),
 first_message text, follow_up_1 text, follow_up_2 text, mode text not null default 'approval_required' check(mode in ('automatic','approval_required')),
 status text not null default 'draft' check(status in ('draft','active','paused','archived')), activated_by uuid references public.profiles(id), activated_at timestamptz,
 check(window_start < window_end), check(status<>'active' or (activated_by is not null and activated_at is not null)),
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique(organization_id,id)
);
create index campaigns_org_idx on public.campaigns(organization_id);

create table public.campaign_leads (
 id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id),
 campaign_id uuid not null, lead_id uuid not null, step integer not null default 0 check(step between 0 and 3),
 next_action_at timestamptz, stopped_at timestamptz, stop_reason text, unique(organization_id,campaign_id,lead_id),
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique(organization_id,id)
);
create index campaign_leads_org_idx on public.campaign_leads(organization_id);

create table public.conversations (
 id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id),
 lead_id uuid not null, channel text not null default 'email' check(channel in ('email','whatsapp')), provider_thread_id text,
 summary text, unique(organization_id,lead_id,channel), unique(organization_id,id,lead_id),
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique(organization_id,id)
);
create index conversations_org_idx on public.conversations(organization_id);

create table public.messages (
 id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id),
 lead_id uuid not null, conversation_id uuid, campaign_id uuid,
 direction text not null check(direction in ('inbound','outbound')), channel text not null default 'email' check(channel in ('email','whatsapp')),
 subject text, body text not null, status text not null default 'draft' check(status in ('draft','approved','queued','sending','sent','delivered','opened','received','bounced','failed','cancelled')),
 provider text, provider_message_id text, idempotency_key text not null, in_reply_to uuid, follow_up_number integer check(follow_up_number between 0 and 2),
 approved_by uuid references public.profiles(id), approved_at timestamptz, sent_at timestamptz, received_at timestamptz,
 model text, classification text, knowledge_document_ids uuid[] not null default '{}', metadata jsonb not null default '{}',
 unique(organization_id,idempotency_key), unique(provider,provider_message_id), unique(organization_id,in_reply_to), unique(organization_id,id,lead_id),
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique(organization_id,id)
);
create index messages_org_idx on public.messages(organization_id);

create table public.activities (
 id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id),
 lead_id uuid, actor_id uuid, action text not null, entity_table text, entity_id uuid,
 model text, details jsonb not null default '{}' ,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique(organization_id,id)
);
create index activities_org_idx on public.activities(organization_id);

create table public.tasks (
 id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id),
 lead_id uuid, title text not null, description text, assigned_to uuid,
 status text not null default 'open' check(status in ('open','in_progress','completed','cancelled')), due_at timestamptz,
 foreign key(organization_id,assigned_to) references public.organization_members(organization_id,user_id),
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique(organization_id,id)
);
create index tasks_org_idx on public.tasks(organization_id);

create table public.demos (
 id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id),
 lead_id uuid not null, status text not null default 'script_pending' check(status in ('script_pending','audio_awaiting_configuration','generating','ready','failed')),
 script jsonb, storage_path text, duration_seconds integer check(duration_seconds between 35 and 60),
 share_token uuid not null default gen_random_uuid() unique, expires_at timestamptz, revoked_at timestamptz,
 idempotency_key text not null, model text, unique(organization_id,idempotency_key),
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique(organization_id,id)
);
create index demos_org_idx on public.demos(organization_id);

create table public.knowledge_base_documents (
 id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id),
 title text not null, category text not null check(category in ('product','pricing','objections','integrations','onboarding','compliance','case_studies')),
 content text not null, active boolean not null default true, version integer not null default 1 check(version>0),
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique(organization_id,id)
);
create index knowledge_base_documents_org_idx on public.knowledge_base_documents(organization_id);

create table public.knowledge_base_versions (
 id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id),
 document_id uuid not null, title text not null, content text not null, category text not null,
 version integer not null, edited_by uuid, unique(organization_id,document_id,version),
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique(organization_id,id)
);
create index knowledge_base_versions_org_idx on public.knowledge_base_versions(organization_id);

create table public.automation_jobs (
 id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id),
 lead_id uuid, kind text not null check(kind in ('enrich_new_leads','create_outreach_drafts','send_due_messages','process_follow_ups','process_inbound_replies','generate_requested_demos','notify_human_required','sync_payment_events','daily_summary')),
 status text not null default 'pending' check(status in ('pending','running','completed','failed','cancelled')),
 payload jsonb not null default '{}', idempotency_key text not null, next_action_at timestamptz not null default now(),
 attempts integer not null default 0 check(attempts>=0), max_attempts integer not null default 5 check(max_attempts between 1 and 10),
 locked_until timestamptz, lock_token uuid, last_error text, completed_at timestamptz, unique(organization_id,idempotency_key),
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique(organization_id,id)
);
create index automation_jobs_org_idx on public.automation_jobs(organization_id);

create table public.suppression_list (
 id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id),
 lead_id uuid, channel text not null check(channel in ('email','whatsapp','all')), identifier text not null check(identifier=lower(trim(identifier)) and length(identifier)>0),
 reason text not null, unique(organization_id,channel,identifier),
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique(organization_id,id)
);
create index suppression_list_org_idx on public.suppression_list(organization_id);

create table public.integrations (
 id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id),
 provider text not null, enabled boolean not null default false, public_config jsonb not null default '{}',
 last_verified_at timestamptz, unique(organization_id,provider),
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique(organization_id,id)
);
create index integrations_org_idx on public.integrations(organization_id);

create table public.settings (
 id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id),
 key text not null, value jsonb not null, unique(organization_id,key),
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique(organization_id,id)
);
create index settings_org_idx on public.settings(organization_id);

create table public.onboarding_records (
 id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id),
 lead_id uuid not null, status text not null default 'pending' check(status in ('pending','in_progress','completed')),
 clinic_data jsonb not null default '{}', services jsonb not null default '[]', schedule jsonb not null default '{}', preferred_greeting text,
 transfer_rules text, appointment_rules text, calendar_setup jsonb not null default '{}', contact_person jsonb not null default '{}',
 payment_provider text, payment_reference text, amount_paid numeric(12,2) check(amount_paid>=0), currency text not null default 'RON',
 unique(organization_id,lead_id), unique(payment_provider,payment_reference),
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique(organization_id,id)
);
create index onboarding_records_org_idx on public.onboarding_records(organization_id);

create table public.notifications (
 id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id),
 recipient_id uuid, title text not null, body text not null, read_at timestamptz, idempotency_key text not null,
 foreign key(organization_id,recipient_id) references public.organization_members(organization_id,user_id), unique(organization_id,idempotency_key),
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique(organization_id,id)
);
create index notifications_org_idx on public.notifications(organization_id);

create table public.webhook_events (
 id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id),
 provider text not null, event_id text not null, event_type text not null, payload jsonb not null default '{}',
 processed_at timestamptz, error text, unique(provider,event_id),
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique(organization_id,id)
);
create index webhook_events_org_idx on public.webhook_events(organization_id);
alter table public.lead_contacts add foreign key(organization_id,lead_id) references public.leads(organization_id,id);
alter table public.campaign_leads add foreign key(organization_id,lead_id) references public.leads(organization_id,id);
alter table public.campaign_leads add foreign key(organization_id,campaign_id) references public.campaigns(organization_id,id);
alter table public.conversations add foreign key(organization_id,lead_id) references public.leads(organization_id,id);
alter table public.messages add foreign key(organization_id,lead_id) references public.leads(organization_id,id);
alter table public.messages add foreign key(organization_id,campaign_id) references public.campaigns(organization_id,id);
alter table public.activities add foreign key(organization_id,lead_id) references public.leads(organization_id,id);
alter table public.tasks add foreign key(organization_id,lead_id) references public.leads(organization_id,id);
alter table public.demos add foreign key(organization_id,lead_id) references public.leads(organization_id,id);
alter table public.knowledge_base_versions add foreign key(organization_id,document_id) references public.knowledge_base_documents(organization_id,id);
alter table public.automation_jobs add foreign key(organization_id,lead_id) references public.leads(organization_id,id);
alter table public.suppression_list add foreign key(organization_id,lead_id) references public.leads(organization_id,id);
alter table public.onboarding_records add foreign key(organization_id,lead_id) references public.leads(organization_id,id);
alter table public.messages add foreign key(organization_id,conversation_id,lead_id) references public.conversations(organization_id,id,lead_id);
alter table public.messages add foreign key(organization_id,in_reply_to,lead_id) references public.messages(organization_id,id,lead_id);
create unique index leads_email_unique on public.leads(organization_id,normalized_email) where normalized_email is not null;
create unique index leads_phone_unique on public.leads(organization_id,normalized_phone) where normalized_phone is not null;
create unique index leads_website_unique on public.leads(organization_id,normalized_website) where normalized_website is not null;
create unique index leads_company_city_unique on public.leads(organization_id,normalized_company_city);
create index leads_queue_idx on public.leads(organization_id,next_action_at) where next_action_at is not null and not do_not_contact;
create index leads_status_idx on public.leads(organization_id,status,lead_score desc);
create index leads_filters_idx on public.leads(organization_id,city,niche);
create index leads_owner_idx on public.leads(organization_id,owner_id);
create index jobs_due_idx on public.automation_jobs(next_action_at) where status='pending';
create index jobs_lease_idx on public.automation_jobs(locked_until) where status='running';
create index activities_timeline_idx on public.activities(organization_id,lead_id,created_at desc);
create index messages_thread_idx on public.messages(organization_id,conversation_id,created_at);
create unique index initial_outreach_once on public.messages(organization_id,lead_id,channel) where direction='outbound' and follow_up_number=0 and status in ('queued','sending','sent','delivered','opened');
