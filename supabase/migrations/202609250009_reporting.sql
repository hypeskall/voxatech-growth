create function public.daily_metrics(org uuid,day date default (now() at time zone 'Europe/Bucharest')::date) returns jsonb language sql stable security definer set search_path='' as $$
select jsonb_build_object(
 'new_leads',(select count(*) from public.leads where organization_id=org and (created_at at time zone 'Europe/Bucharest')::date=day),
 'contacted',(select count(distinct lead_id) from public.messages where organization_id=org and direction='outbound' and (sent_at at time zone 'Europe/Bucharest')::date=day),
 'replies',(select count(distinct lead_id) from public.messages where organization_id=org and direction='inbound' and (received_at at time zone 'Europe/Bucharest')::date=day),
 'qualified',(select count(distinct lead_id) from public.activities where organization_id=org and details->>'to_status'='QUALIFIED' and details->>'from_status' is distinct from 'QUALIFIED' and (created_at at time zone 'Europe/Bucharest')::date=day),
 'demos_sent',(select count(distinct lead_id) from public.messages where organization_id=org and metadata ? 'demo_id' and (sent_at at time zone 'Europe/Bucharest')::date=day),
 'hot_attention',(select count(*) from public.leads where organization_id=org and status='HUMAN_REQUIRED' and lead_score>=80),
 'failures',(select count(*) from public.automation_jobs where organization_id=org and status='failed')
); $$;
revoke all on function public.daily_metrics(uuid,date) from public,anon,authenticated;
grant execute on function public.daily_metrics(uuid,date) to service_role;
