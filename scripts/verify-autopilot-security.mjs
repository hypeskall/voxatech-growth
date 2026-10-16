import {management} from './shared.mjs';
import assert from 'node:assert/strict';
const tables=await management('/database/query','POST',{query:`select relname,relrowsecurity,has_table_privilege('anon',c.oid,'select') as anon_read,has_table_privilege('authenticated',c.oid,'insert') as tenant_insert,has_table_privilege('authenticated',c.oid,'update') as tenant_update from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and relname in ('autopilot_settings','autopilot_runs','autopilot_usage','autopilot_candidates')`});
assert.equal(tables.length,4);assert.ok(tables.every(t=>t.relrowsecurity && !t.anon_read && !t.tenant_insert && !t.tenant_update));
const functions=await management('/database/query','POST',{query:`select proname,has_function_privilege('anon',p.oid,'EXECUTE') as anon_execute,has_function_privilege('authenticated',p.oid,'EXECUTE') as tenant_execute from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and (proname like '%autopilot%' or proname='commit_autopilot_lead')`});
assert.ok(functions.length>=10);assert.ok(functions.every(f=>!f.anon_execute && !f.tenant_execute));
console.log(JSON.stringify({tablesProtected:tables.length,workerFunctionsProtected:functions.length}));
const advisors=await fetch(`https://api.supabase.com/v1/projects/${new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).hostname.split('.')[0]}/advisors/security`,{headers:{Authorization:`Bearer ${process.env.SUPABASE_ACCESS_TOKEN}`}});
if(advisors.ok){const data=await advisors.json();const lints=data.lints||[];console.log({securityAdvisorStatus:200,autopilotFindings:lints.filter(l=>JSON.stringify(l.metadata||{}).includes('autopilot')).map(l=>({name:l.name,level:l.level}))});}
else console.log({securityAdvisorStatus:advisors.status,explicitPrivilegeAndRlsChecks:'passed'});
