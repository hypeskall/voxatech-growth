-- No anonymous reads; service-role credentials remain server-only.
create function private.touch_updated_at() returns trigger language plpgsql set search_path='' as $$
begin new.updated_at=now(); return new; end; $$;
alter table public.organizations enable row level security;
revoke all on public.organizations from anon,authenticated;
grant select on public.organizations to authenticated;
grant all on public.organizations to service_role;
create trigger touch_updated_at before update on public.organizations for each row execute function private.touch_updated_at();
create policy tenant_read on public.organizations for select to authenticated using(private.member_of(id));
alter table public.profiles enable row level security;
revoke all on public.profiles from anon,authenticated;
grant select on public.profiles to authenticated;
grant all on public.profiles to service_role;
create trigger touch_updated_at before update on public.profiles for each row execute function private.touch_updated_at();
create policy profiles_read on public.profiles for select to authenticated using (id=(select auth.uid()) or exists(select 1 from public.organization_members m where m.user_id=profiles.id and private.member_of(m.organization_id)));
grant update(full_name) on public.profiles to authenticated;
create policy profiles_edit on public.profiles for update to authenticated using(id=(select auth.uid())) with check(id=(select auth.uid()));
alter table public.organization_members enable row level security;
revoke all on public.organization_members from anon,authenticated;
grant select on public.organization_members to authenticated;
grant all on public.organization_members to service_role;
create policy tenant_read on public.organization_members for select to authenticated using(private.member_of(organization_id));
alter table public.leads enable row level security;
revoke all on public.leads from anon,authenticated;
grant select on public.leads to authenticated;
grant all on public.leads to service_role;
create trigger touch_updated_at before update on public.leads for each row execute function private.touch_updated_at();
create policy tenant_read on public.leads for select to authenticated using(private.member_of(organization_id));
grant insert,update on public.leads to authenticated;
create policy tenant_insert on public.leads for insert to authenticated with check(private.member_of(organization_id,array['owner','admin','operator']::public.member_role[]));
create policy tenant_update on public.leads for update to authenticated using(private.member_of(organization_id,array['owner','admin','operator']::public.member_role[])) with check(private.member_of(organization_id,array['owner','admin','operator']::public.member_role[]));
alter table public.lead_contacts enable row level security;
revoke all on public.lead_contacts from anon,authenticated;
grant select on public.lead_contacts to authenticated;
grant all on public.lead_contacts to service_role;
create trigger touch_updated_at before update on public.lead_contacts for each row execute function private.touch_updated_at();
create policy tenant_read on public.lead_contacts for select to authenticated using(private.member_of(organization_id));
grant insert,update on public.lead_contacts to authenticated;
create policy tenant_insert on public.lead_contacts for insert to authenticated with check(private.member_of(organization_id,array['owner','admin','operator']::public.member_role[]));
create policy tenant_update on public.lead_contacts for update to authenticated using(private.member_of(organization_id,array['owner','admin','operator']::public.member_role[])) with check(private.member_of(organization_id,array['owner','admin','operator']::public.member_role[]));
alter table public.campaigns enable row level security;
revoke all on public.campaigns from anon,authenticated;
grant select on public.campaigns to authenticated;
grant all on public.campaigns to service_role;
create trigger touch_updated_at before update on public.campaigns for each row execute function private.touch_updated_at();
create policy tenant_read on public.campaigns for select to authenticated using(private.member_of(organization_id));
grant insert,update on public.campaigns to authenticated;
create policy tenant_insert on public.campaigns for insert to authenticated with check(private.member_of(organization_id,array['owner','admin']::public.member_role[]));
create policy tenant_update on public.campaigns for update to authenticated using(private.member_of(organization_id,array['owner','admin']::public.member_role[])) with check(private.member_of(organization_id,array['owner','admin']::public.member_role[]));
alter table public.campaign_leads enable row level security;
revoke all on public.campaign_leads from anon,authenticated;
grant select on public.campaign_leads to authenticated;
grant all on public.campaign_leads to service_role;
create trigger touch_updated_at before update on public.campaign_leads for each row execute function private.touch_updated_at();
create policy tenant_read on public.campaign_leads for select to authenticated using(private.member_of(organization_id));
grant insert,update on public.campaign_leads to authenticated;
create policy tenant_insert on public.campaign_leads for insert to authenticated with check(private.member_of(organization_id,array['owner','admin','operator']::public.member_role[]));
create policy tenant_update on public.campaign_leads for update to authenticated using(private.member_of(organization_id,array['owner','admin','operator']::public.member_role[])) with check(private.member_of(organization_id,array['owner','admin','operator']::public.member_role[]));
alter table public.conversations enable row level security;
revoke all on public.conversations from anon,authenticated;
grant select on public.conversations to authenticated;
grant all on public.conversations to service_role;
create trigger touch_updated_at before update on public.conversations for each row execute function private.touch_updated_at();
create policy tenant_read on public.conversations for select to authenticated using(private.member_of(organization_id));
grant insert,update on public.conversations to authenticated;
create policy tenant_insert on public.conversations for insert to authenticated with check(private.member_of(organization_id,array['owner','admin','operator']::public.member_role[]));
create policy tenant_update on public.conversations for update to authenticated using(private.member_of(organization_id,array['owner','admin','operator']::public.member_role[])) with check(private.member_of(organization_id,array['owner','admin','operator']::public.member_role[]));
alter table public.messages enable row level security;
revoke all on public.messages from anon,authenticated;
grant select on public.messages to authenticated;
grant all on public.messages to service_role;
create trigger touch_updated_at before update on public.messages for each row execute function private.touch_updated_at();
create policy tenant_read on public.messages for select to authenticated using(private.member_of(organization_id));
alter table public.activities enable row level security;
revoke all on public.activities from anon,authenticated;
grant select on public.activities to authenticated;
grant all on public.activities to service_role;
create trigger touch_updated_at before update on public.activities for each row execute function private.touch_updated_at();
create policy tenant_read on public.activities for select to authenticated using(private.member_of(organization_id));
alter table public.tasks enable row level security;
revoke all on public.tasks from anon,authenticated;
grant select on public.tasks to authenticated;
grant all on public.tasks to service_role;
create trigger touch_updated_at before update on public.tasks for each row execute function private.touch_updated_at();
create policy tenant_read on public.tasks for select to authenticated using(private.member_of(organization_id));
grant insert,update on public.tasks to authenticated;
create policy tenant_insert on public.tasks for insert to authenticated with check(private.member_of(organization_id,array['owner','admin','operator']::public.member_role[]));
create policy tenant_update on public.tasks for update to authenticated using(private.member_of(organization_id,array['owner','admin','operator']::public.member_role[])) with check(private.member_of(organization_id,array['owner','admin','operator']::public.member_role[]));
alter table public.demos enable row level security;
revoke all on public.demos from anon,authenticated;
grant select on public.demos to authenticated;
grant all on public.demos to service_role;
create trigger touch_updated_at before update on public.demos for each row execute function private.touch_updated_at();
create policy tenant_read on public.demos for select to authenticated using(private.member_of(organization_id));
alter table public.knowledge_base_documents enable row level security;
revoke all on public.knowledge_base_documents from anon,authenticated;
grant select on public.knowledge_base_documents to authenticated;
grant all on public.knowledge_base_documents to service_role;
create trigger touch_updated_at before update on public.knowledge_base_documents for each row execute function private.touch_updated_at();
create policy tenant_read on public.knowledge_base_documents for select to authenticated using(private.member_of(organization_id));
grant insert,update on public.knowledge_base_documents to authenticated;
create policy tenant_insert on public.knowledge_base_documents for insert to authenticated with check(private.member_of(organization_id,array['owner','admin']::public.member_role[]));
create policy tenant_update on public.knowledge_base_documents for update to authenticated using(private.member_of(organization_id,array['owner','admin']::public.member_role[])) with check(private.member_of(organization_id,array['owner','admin']::public.member_role[]));
alter table public.knowledge_base_versions enable row level security;
revoke all on public.knowledge_base_versions from anon,authenticated;
grant select on public.knowledge_base_versions to authenticated;
grant all on public.knowledge_base_versions to service_role;
create trigger touch_updated_at before update on public.knowledge_base_versions for each row execute function private.touch_updated_at();
create policy tenant_read on public.knowledge_base_versions for select to authenticated using(private.member_of(organization_id));
alter table public.automation_jobs enable row level security;
revoke all on public.automation_jobs from anon,authenticated;
grant select on public.automation_jobs to authenticated;
grant all on public.automation_jobs to service_role;
create trigger touch_updated_at before update on public.automation_jobs for each row execute function private.touch_updated_at();
create policy tenant_read on public.automation_jobs for select to authenticated using(private.member_of(organization_id));
alter table public.suppression_list enable row level security;
revoke all on public.suppression_list from anon,authenticated;
grant select on public.suppression_list to authenticated;
grant all on public.suppression_list to service_role;
create trigger touch_updated_at before update on public.suppression_list for each row execute function private.touch_updated_at();
create policy tenant_read on public.suppression_list for select to authenticated using(private.member_of(organization_id));
grant insert,update on public.suppression_list to authenticated;
create policy tenant_insert on public.suppression_list for insert to authenticated with check(private.member_of(organization_id,array['owner','admin','operator']::public.member_role[]));
create policy tenant_update on public.suppression_list for update to authenticated using(private.member_of(organization_id,array['owner','admin','operator']::public.member_role[])) with check(private.member_of(organization_id,array['owner','admin','operator']::public.member_role[]));
alter table public.integrations enable row level security;
revoke all on public.integrations from anon,authenticated;
grant select on public.integrations to authenticated;
grant all on public.integrations to service_role;
create trigger touch_updated_at before update on public.integrations for each row execute function private.touch_updated_at();
create policy tenant_read on public.integrations for select to authenticated using(private.member_of(organization_id));
grant insert,update on public.integrations to authenticated;
create policy tenant_insert on public.integrations for insert to authenticated with check(private.member_of(organization_id,array['owner','admin']::public.member_role[]));
create policy tenant_update on public.integrations for update to authenticated using(private.member_of(organization_id,array['owner','admin']::public.member_role[])) with check(private.member_of(organization_id,array['owner','admin']::public.member_role[]));
alter table public.settings enable row level security;
revoke all on public.settings from anon,authenticated;
grant select on public.settings to authenticated;
grant all on public.settings to service_role;
create trigger touch_updated_at before update on public.settings for each row execute function private.touch_updated_at();
create policy tenant_read on public.settings for select to authenticated using(private.member_of(organization_id));
grant insert,update on public.settings to authenticated;
create policy tenant_insert on public.settings for insert to authenticated with check(private.member_of(organization_id,array['owner','admin']::public.member_role[]));
create policy tenant_update on public.settings for update to authenticated using(private.member_of(organization_id,array['owner','admin']::public.member_role[])) with check(private.member_of(organization_id,array['owner','admin']::public.member_role[]));
alter table public.onboarding_records enable row level security;
revoke all on public.onboarding_records from anon,authenticated;
grant select on public.onboarding_records to authenticated;
grant all on public.onboarding_records to service_role;
create trigger touch_updated_at before update on public.onboarding_records for each row execute function private.touch_updated_at();
create policy tenant_read on public.onboarding_records for select to authenticated using(private.member_of(organization_id));
alter table public.notifications enable row level security;
revoke all on public.notifications from anon,authenticated;
grant select on public.notifications to authenticated;
grant all on public.notifications to service_role;
create trigger touch_updated_at before update on public.notifications for each row execute function private.touch_updated_at();
create policy tenant_read on public.notifications for select to authenticated using(private.member_of(organization_id));
alter table public.webhook_events enable row level security;
revoke all on public.webhook_events from anon,authenticated;
grant select on public.webhook_events to authenticated;
grant all on public.webhook_events to service_role;
create trigger touch_updated_at before update on public.webhook_events for each row execute function private.touch_updated_at();
create policy tenant_read on public.webhook_events for select to authenticated using(private.member_of(organization_id));

-- Audit metadata only: no full message bodies, credentials, or personal records copied to logs.
create function private.audit_change() returns trigger language plpgsql security definer set search_path='' as $$
declare record_data jsonb;
begin
 record_data=case when TG_OP='DELETE' then to_jsonb(old) else to_jsonb(new) end;
 insert into public.activities(organization_id,actor_id,action,entity_table,entity_id,lead_id,details)
 values((record_data->>'organization_id')::uuid,auth.uid(),lower(TG_OP),TG_TABLE_NAME,(record_data->>'id')::uuid,
 case when TG_TABLE_NAME='leads' then (record_data->>'id')::uuid else null end,jsonb_build_object('source','database'));
 return case when TG_OP='DELETE' then old else new end;
end; $$;
create function private.version_knowledge() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if TG_OP='UPDATE' then new.version=old.version+1; end if;
 return new;
end; $$;
create function private.save_knowledge_version() returns trigger language plpgsql security definer set search_path='' as $$
begin
 insert into public.knowledge_base_versions(organization_id,document_id,title,content,category,version,edited_by)
 values(new.organization_id,new.id,new.title,new.content,new.category,new.version,auth.uid());
 return new;
end; $$;
create trigger knowledge_version before update on public.knowledge_base_documents for each row execute function private.version_knowledge();
create trigger knowledge_snapshot after insert or update on public.knowledge_base_documents for each row execute function private.save_knowledge_version();
create function private.protect_campaign_activation() returns trigger language plpgsql set search_path='' as $$
begin
 if new.status='active' and (TG_OP='INSERT' or old.status<>'active') then
  if auth.uid() is null or not private.member_of(new.organization_id,array['owner','admin']::public.member_role[]) then
   raise exception 'Activation requires a signed-in organization administrator' using errcode='42501';
  end if;
  new.activated_by=auth.uid(); new.activated_at=now();
 end if;
 return new;
end; $$;
create trigger campaign_activation before insert or update on public.campaigns for each row execute function private.protect_campaign_activation();
create function private.stop_contact() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.do_not_contact or new.status='DO_NOT_CONTACT' then
  new.do_not_contact=true; new.status='DO_NOT_CONTACT'; new.next_action_at=null;
  update public.campaign_leads set stopped_at=now(),stop_reason='do_not_contact',next_action_at=null where organization_id=new.organization_id and lead_id=new.id;
  update public.messages set status='cancelled' where organization_id=new.organization_id and lead_id=new.id and direction='outbound' and status in ('draft','approved','queued');
  update public.automation_jobs set status='cancelled' where organization_id=new.organization_id and lead_id=new.id and status='pending';
 end if;
 return new;
end; $$;
create trigger lead_stop_contact before update on public.leads for each row execute function private.stop_contact();
create trigger audit_change after insert or update or delete on public.leads for each row execute function private.audit_change();
create trigger audit_change after insert or update or delete on public.lead_contacts for each row execute function private.audit_change();
create trigger audit_change after insert or update or delete on public.campaigns for each row execute function private.audit_change();
create trigger audit_change after insert or update or delete on public.campaign_leads for each row execute function private.audit_change();
create trigger audit_change after insert or update or delete on public.organization_members for each row execute function private.audit_change();
create trigger audit_change after insert or update or delete on public.tasks for each row execute function private.audit_change();
create trigger audit_change after insert or update or delete on public.demos for each row execute function private.audit_change();
create trigger audit_change after insert or update or delete on public.knowledge_base_documents for each row execute function private.audit_change();
create trigger audit_change after insert or update or delete on public.settings for each row execute function private.audit_change();
create trigger audit_change after insert or update or delete on public.integrations for each row execute function private.audit_change();
create trigger audit_change after insert or update or delete on public.suppression_list for each row execute function private.audit_change();
create trigger audit_change after insert or update or delete on public.onboarding_records for each row execute function private.audit_change();
-- Explicit service-only atomic job leasing; expired leases are reclaimed with a new fencing token.
create function public.claim_automation_jobs(batch_size integer default 10) returns setof public.automation_jobs
language plpgsql security definer set search_path='' as $$
begin
 update public.automation_jobs set status='failed',last_error='Retry limit reached after expired lease',locked_until=null,lock_token=null
 where status='running' and locked_until<now() and attempts>=max_attempts;
 return query
 with due as (
  select id from public.automation_jobs where ((status='pending' and next_action_at<=now()) or (status='running' and locked_until<now())) and attempts<max_attempts
  order by next_action_at for update skip locked limit greatest(1,least(batch_size,100))
 ) update public.automation_jobs j set status='running',attempts=attempts+1,locked_until=now()+interval '5 minutes',lock_token=gen_random_uuid()
 from due where j.id=due.id returning j.*;
end; $$;
create function public.finish_automation_job(job_id uuid, token uuid, failure text default null) returns boolean
language plpgsql security definer set search_path='' as $$
declare changed public.automation_jobs;
begin
 update public.automation_jobs set status=case when failure is null then 'completed' when attempts>=max_attempts then 'failed' else 'pending' end,
 completed_at=case when failure is null then now() else null end,
 next_action_at=case when failure is null then next_action_at else now()+make_interval(secs=>least(3600,30*power(2,attempts)::integer)) end,
 last_error=left(failure,1000),locked_until=null,lock_token=null
 where id=job_id and lock_token=token and status='running' and locked_until>now() returning * into changed;
 if not found then return false; end if;
 insert into public.activities(organization_id,lead_id,action,entity_table,entity_id,details)
 values(changed.organization_id,changed.lead_id,case when failure is null then 'job_completed' else 'job_failed' end,'automation_jobs',changed.id,jsonb_build_object('kind',changed.kind,'attempt',changed.attempts));
 return true;
end; $$;
revoke all on function public.claim_automation_jobs(integer) from public,anon,authenticated;
revoke all on function public.finish_automation_job(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.claim_automation_jobs(integer) to service_role;
grant execute on function public.finish_automation_job(uuid,uuid,text) to service_role;
revoke execute on function private.on_auth_user_created(),private.touch_updated_at(),private.audit_change(),private.version_knowledge(),private.save_knowledge_version(),private.protect_campaign_activation(),private.stop_contact() from public,anon;
