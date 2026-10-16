import { management } from './shared.mjs';

const sources = "'evaluare-controlata','ai-controlled-test','dry-run-audit-20260925'";
const query = `select organization_id,source,count(*)::int as count from public.leads where deleted_at is null group by organization_id,source order by source`;
console.log(JSON.stringify(await management('/database/query','POST',{query}),null,2));
if (process.argv.includes('--apply')) {
  const cleanup = `do $$ declare org uuid; actor uuid; targets uuid[]; begin
    select organization_id into strict org from public.leads where deleted_at is null and source in (${sources}) group by organization_id;
    select user_id into strict actor from public.organization_members where organization_id=org and role='owner';
    select array_agg(id) into targets from public.leads where organization_id=org and deleted_at is null and source in (${sources});
    if cardinality(targets)<>31 then raise exception 'Unexpected cleanup cohort'; end if;
    if (select count(*) from public.leads where organization_id=org and deleted_at is null and source='CSV')<>10 then raise exception 'Imported lead guard failed'; end if;
    perform public.trash_leads(org,targets,actor);
  end $$;`;
  await management('/database/query','POST',{query:cleanup});
}
console.log(JSON.stringify(await management('/database/query','POST',{query:`select source,deleted_at is not null as in_trash,count(*)::int as count from public.leads group by source,deleted_at is not null order by source; select enabled,require_website,daily_ai_budget_usd from public.autopilot_settings;`}),null,2));
