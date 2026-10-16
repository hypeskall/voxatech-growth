-- Recheck a reserved outbound message immediately before the durable Gmail
-- claim. An opt-out or inbound reply may arrive after the worker reserved it.
-- Internal tests use namespaced keys, not application message UUIDs.
create or replace function public.claim_gmail_delivery(org uuid,mailbox uuid,request_key text) returns boolean
language plpgsql security invoker set search_path='' as $$
declare a public.gmail_accounts; m public.messages; l public.leads; c public.campaigns;
 local_now timestamp; transactional boolean; human_approved boolean;
begin
 select * into a from public.gmail_accounts where organization_id=org and id=mailbox for update;
 if not found or a.status<>'connected' or a.encrypted_refresh_token is null then
  raise exception 'Gmail necesită reconectare.';
 end if;
 if exists(select 1 from public.gmail_delivery_attempts where organization_id=org and delivery_key=request_key) then return false; end if;
 if request_key ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
  select * into m from public.messages where organization_id=org and id::text=request_key;
  if not found or m.direction<>'outbound' or m.status<>'sending' then
   raise exception 'GMAIL_STOPPED: Mesajul a fost oprit sau modificat.';
  end if;
  human_approved:=coalesce(m.metadata->>'human_approved','false')='true';
  transactional:=coalesce(m.metadata->>'transactional_onboarding','false')='true';
  select * into l from public.leads where organization_id=org and id=m.lead_id;
  if not found or l.deleted_at is not null or l.do_not_contact or l.email is null
    or l.status in ('LOST','DO_NOT_CONTACT') or (l.status='WON' and not transactional)
    or (l.status='HUMAN_REQUIRED' and not human_approved) then
   raise exception 'GMAIL_STOPPED: Starea leadului nu mai permite trimiterea.';
  end if;
  if exists(select 1 from public.suppression_list where organization_id=org and (lead_id=l.id or identifier=lower(trim(l.email)))) then
   raise exception 'GMAIL_STOPPED: Contactarea acestui lead este oprită.';
  end if;
  if m.follow_up_number is not null and exists(select 1 from public.messages where organization_id=org and lead_id=l.id and direction='inbound') then
   raise exception 'GMAIL_STOPPED: Leadul a răspuns deja. Abordarea inițială și revenirile se opresc.';
  end if;
  if m.follow_up_number is not null and not exists(select 1 from public.campaign_leads where organization_id=org and campaign_id=m.campaign_id and lead_id=l.id and stopped_at is null) then
   raise exception 'GMAIL_STOPPED: Leadul a fost oprit în campanie.';
  end if;
  if not transactional then
   select * into c from public.campaigns where organization_id=org and id=m.campaign_id;
   if not found or c.status<>'active' or c.activated_by is null then raise exception 'GMAIL_DEFERRED: Campania nu este activă.'; end if;
   local_now:=now() at time zone 'Europe/Bucharest';
   if (c.weekdays_only and extract(isodow from local_now)>5)
     or local_now::time<c.window_start or local_now::time>=c.window_end then
    raise exception 'GMAIL_DEFERRED: În afara intervalului de trimitere.';
   end if;
  end if;
  if a.last_test_at is null or a.last_synced_at is null or a.last_synced_at<now()-interval '15 minutes'
    or exists(select 1 from public.gmail_threads where organization_id=org and account_id=mailbox and lead_id=l.id and (last_synced_at is null or last_synced_at<now()-interval '15 minutes')) then
   raise exception 'GMAIL_DEFERRED: Testul sau sincronizarea Gmail trebuie actualizate.';
  end if;
 end if;
 if a.campaign_id is not null and exists(select 1 from public.messages where organization_id=org and id::text=request_key and campaign_id=a.campaign_id)
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
