import { management } from "./shared.mjs";
console.log(
  JSON.stringify(
    await management("/database/query", "POST", {
      query: `select 'knowledge' section,coalesce(jsonb_agg(jsonb_build_object('id',id,'title',title,'category',category,'active',active)),'[]') data from public.knowledge_base_documents where organization_id='10000000-0000-4000-8000-000000000001' union all select 'drafts',coalesce(jsonb_agg(x),'[]') from (select status,count(*) count,bool_or(approved_by is not null) approved from public.messages where direction='outbound' and metadata ? 'outreach_variant' group by status) x union all select 'real_leads',coalesce(jsonb_agg(jsonb_build_object('id',id,'company',company_name,'website',website,'source',source,'city',city)),'[]') from public.leads where source='evaluare-controlata'`,
    }),
    null,
    2,
  ),
);
