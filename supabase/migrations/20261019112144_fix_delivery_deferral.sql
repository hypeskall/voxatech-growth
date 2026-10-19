-- Keep a short retry inside the current campaign window. Only advance to a
-- later day when the retry is past closing time or falls on a closed day.
create function private.delivery_retry_at(
 ready_at timestamptz, start_at time, end_at time, weekdays boolean
) returns timestamptz
language plpgsql stable security invoker set search_path='' as $$
declare local_ready timestamp; candidate date;
begin
 if start_at is null or end_at is null then return ready_at; end if;
 local_ready:=ready_at at time zone 'Europe/Bucharest';
 candidate:=local_ready::date;
 if local_ready::time>=end_at then candidate:=candidate+1; end if;
 while weekdays and extract(isodow from candidate)>5 loop
  candidate:=candidate+1;
 end loop;
 if candidate=local_ready::date and local_ready::time>=start_at
    and local_ready::time<end_at then
  return ready_at;
 end if;
 return (candidate+start_at) at time zone 'Europe/Bucharest';
end; $$;
revoke all on function private.delivery_retry_at(timestamptz,time,time,boolean) from public,anon,authenticated;
grant execute on function private.delivery_retry_at(timestamptz,time,time,boolean) to service_role;

create or replace function public.defer_automation_job(job_id uuid,token uuid)
returns boolean language plpgsql security invoker set search_path='' as $$
declare resume_at timestamptz:=now()+interval '15 minutes';
 start_at time; end_at time; weekdays boolean; campaign_ready timestamptz;
 mailbox_ready timestamptz;
begin
 select c.window_start,c.window_end,c.weekdays_only,c.next_send_at,a.next_send_at
 into start_at,end_at,weekdays,campaign_ready,mailbox_ready
 from public.automation_jobs j
 join public.messages m on m.organization_id=j.organization_id
  and m.id=(j.payload->>'message_id')::uuid
 left join public.campaigns c on c.organization_id=m.organization_id and c.id=m.campaign_id
 left join public.gmail_accounts a on a.organization_id=c.organization_id and a.email=c.sender_identity
 where j.id=job_id and j.status='running' and j.lock_token=token and j.locked_until>now();
 resume_at:=private.delivery_retry_at(
  greatest(resume_at,campaign_ready,mailbox_ready),start_at,end_at,weekdays
 );
 update public.automation_jobs
 set status='pending',attempts=greatest(0,attempts-1),next_action_at=resume_at,
  lock_token=null,locked_until=null
 where id=job_id and lock_token=token and status='running' and locked_until>now();
 return found;
end; $$;
revoke all on function public.defer_automation_job(uuid,uuid) from public,anon,authenticated;
grant execute on function public.defer_automation_job(uuid,uuid) to service_role;
