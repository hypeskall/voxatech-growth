create function public.schedule_due_jobs(target_org uuid default null,delivery_mode text default 'log') returns void language plpgsql security definer set search_path='' as $$
begin
 insert into public.automation_jobs(organization_id,lead_id,kind,idempotency_key,payload)
 select m.organization_id,m.lead_id,'send_due_messages','send:'||delivery_mode||':'||m.id,jsonb_build_object('message_id',m.id)
 from public.messages m join public.leads l on l.id=m.lead_id
 where m.direction='outbound' and m.status in ('approved','queued','sending') and not l.do_not_contact and l.status not in ('LOST','HUMAN_REQUIRED') and (target_org is null or m.organization_id=target_org)
 on conflict(organization_id,idempotency_key) do nothing;
 insert into public.automation_jobs(organization_id,lead_id,kind,idempotency_key,payload)
 select c.organization_id,cl.lead_id,'create_outreach_drafts','initial:'||c.id||':'||cl.lead_id,jsonb_build_object('campaign_id',c.id,'step',0)
 from public.campaigns c join public.campaign_leads cl on cl.campaign_id=c.id join public.leads l on l.id=cl.lead_id
 where c.status='active' and cl.stopped_at is null and not l.do_not_contact and l.status not in ('LOST','HUMAN_REQUIRED','WON') and (target_org is null or c.organization_id=target_org)
 and not exists(select 1 from public.messages m where m.campaign_id=c.id and m.lead_id=cl.lead_id and m.follow_up_number=0)
 on conflict(organization_id,idempotency_key) do nothing;
 insert into public.automation_jobs(organization_id,lead_id,kind,idempotency_key,payload)
 select c.organization_id,cl.lead_id,'process_follow_ups','follow:'||c.id||':'||cl.lead_id||':'||(last_message.follow_up_number+1),jsonb_build_object('campaign_id',c.id,'step',last_message.follow_up_number+1)
 from public.campaigns c join public.campaign_leads cl on cl.campaign_id=c.id join public.leads l on l.id=cl.lead_id
 cross join lateral(select m.follow_up_number,m.sent_at from public.messages m where m.campaign_id=c.id and m.lead_id=cl.lead_id and m.sent_at is not null and m.follow_up_number is not null order by m.follow_up_number desc limit 1) last_message
 where c.status='active' and cl.stopped_at is null and not l.do_not_contact and l.status not in ('LOST','HUMAN_REQUIRED','WON') and last_message.follow_up_number<c.max_follow_ups and last_message.sent_at<now()-interval '3 days'
 and (target_org is null or c.organization_id=target_org)
 and not exists(select 1 from public.messages m where m.lead_id=cl.lead_id and m.direction='inbound')
 on conflict(organization_id,idempotency_key) do nothing;
 if (now() at time zone 'Europe/Bucharest')::time>='18:30' then
 insert into public.automation_jobs(organization_id,kind,idempotency_key)
 select id,'daily_summary','summary:'||(now() at time zone 'Europe/Bucharest')::date from public.organizations where target_org is null or id=target_org
 on conflict(organization_id,idempotency_key) do nothing;
 end if;
end; $$;
revoke all on function public.schedule_due_jobs(uuid,text) from public,anon,authenticated;
grant execute on function public.schedule_due_jobs(uuid,text) to service_role;
