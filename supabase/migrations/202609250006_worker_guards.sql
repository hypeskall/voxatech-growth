create function public.claim_organization_job(target_org uuid default null) returns setof public.automation_jobs language plpgsql security definer set search_path='' as $$
begin
 update public.automation_jobs set status='failed',last_error='Retry limit reached after expired lease',locked_until=null,lock_token=null
 where status='running' and locked_until<now() and attempts>=max_attempts and (target_org is null or organization_id=target_org);
 return query with due as (
 select id from public.automation_jobs where (target_org is null or organization_id=target_org) and ((status='pending' and next_action_at<=now()) or (status='running' and locked_until<now())) and attempts<max_attempts order by next_action_at for update skip locked limit 1
 ) update public.automation_jobs j set status='running',attempts=attempts+1,locked_until=now()+interval '5 minutes',lock_token=gen_random_uuid() from due where j.id=due.id returning j.*;
end; $$;
create function public.defer_automation_job(job_id uuid,token uuid) returns boolean language plpgsql security definer set search_path='' as $$
begin
 update public.automation_jobs set status='pending',attempts=greatest(0,attempts-1),next_action_at=now()+interval '15 minutes',lock_token=null,locked_until=null
 where id=job_id and lock_token=token and status='running' and locked_until>now();
 return found;
end; $$;
revoke all on function public.claim_organization_job(uuid),public.defer_automation_job(uuid,uuid) from public,anon,authenticated;
grant execute on function public.claim_organization_job(uuid),public.defer_automation_job(uuid,uuid) to service_role;
create or replace function private.audit_change() returns trigger language plpgsql security definer set search_path='' as $$
declare record_data jsonb; previous_data jsonb;
begin
 record_data=case when TG_OP='DELETE' then to_jsonb(old) else to_jsonb(new) end;
 previous_data=case when TG_OP='INSERT' then '{}'::jsonb else to_jsonb(old) end;
 insert into public.activities(organization_id,actor_id,action,entity_table,entity_id,lead_id,details)
 values((record_data->>'organization_id')::uuid,auth.uid(),lower(TG_OP),TG_TABLE_NAME,(record_data->>'id')::uuid,
 case when TG_TABLE_NAME='leads' then (record_data->>'id')::uuid else null end,jsonb_build_object('source','database','from_status',previous_data->>'status','to_status',record_data->>'status'));
 return case when TG_OP='DELETE' then old else new end;
end; $$;
-- A refusal also cancels messages that were reserved but not yet delivered.
create function private.reject_suppressed_queue() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.direction='outbound' and new.status in ('queued','approved','sending') and exists(select 1 from public.leads l where l.id=new.lead_id and l.organization_id=new.organization_id and (l.do_not_contact or l.status in ('LOST','HUMAN_REQUIRED'))) then
 raise exception 'Lead cannot receive outbound messages'; end if; return new;
end; $$;
create trigger reject_suppressed_queue before insert or update on public.messages for each row execute function private.reject_suppressed_queue();
revoke execute on function private.reject_suppressed_queue() from public,anon;
