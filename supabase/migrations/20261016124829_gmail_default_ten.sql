-- New mailboxes start with the requested daily cap; existing ones follow it.
alter table public.gmail_accounts alter column daily_cap set default 10;
update public.gmail_accounts set daily_cap=10,updated_at=now() where daily_cap<>10;
update public.campaigns c set daily_cap=10 from public.gmail_accounts a
where a.organization_id=c.organization_id and a.campaign_id=c.id and c.daily_cap<>10;
