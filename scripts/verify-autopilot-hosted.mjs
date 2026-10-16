import { management } from "./shared.mjs";
import { randomUUID } from "node:crypto";
import { writeFile } from "node:fs/promises";
import assert from "node:assert/strict";
const org = randomUUID();
const sql = (query) => management("/database/query", "POST", { query });
const evidence = {
  project: "voxa-growth",
  testedAt: new Date().toISOString(),
  fixtures:
    "isolated temporary organization; no clinic leads or emails created",
};
try {
  await sql(`begin; insert into public.organizations(id,name,slug) values('${org}','Autopilot concurrency verification','autopilot-verification-${org}');
 insert into public.autopilot_settings(organization_id,enabled,storage_rights_confirmed,daily_ai_budget_usd) values('${org}',true,true,1);
 insert into public.automation_jobs(organization_id,kind,idempotency_key,max_attempts)
 select '${org}','autopilot_discover','verification-'||s,2 from generate_series(1,8) s; commit;`);
  const responses = await Promise.all(
    Array.from({ length: 8 }, () =>
      sql(`select id,lock_token from public.claim_autopilot_job('${org}')`),
    ),
  );
  const jobs = responses.flat();
  assert.equal(jobs.length, 8);
  assert.equal(new Set(jobs.map((j) => j.id)).size, 8);
  evidence.concurrentClaims = {
    workers: 8,
    distinctJobs: 8,
    noDuplicateClaims: true,
  };
  const reserve = await Promise.all(
    jobs
      .slice(0, 2)
      .map((j) =>
        sql(
          `select public.reserve_autopilot_request('${j.id}','${j.lock_token}','ai',0.6) as day`,
        ),
      ),
  );
  assert.equal(reserve.filter((r) => r[0].day !== null).length, 1);
  const charged = (
    await sql(
      `select ai_cost_usd from public.autopilot_usage where organization_id='${org}'`,
    )
  )[0];
  assert.equal(Number(charged.ai_cost_usd), 0.6);
  evidence.concurrentBudget = {
    dailyBudget: 1,
    simultaneousReservations: 2,
    eachReservation: 0.6,
    accepted: 1,
    charged: 0.6,
  };
  const job = jobs[2];
  await sql(
    `select public.finish_automation_job('${job.id}','${job.lock_token}','Synthetic provider 429 test')`,
  );
  const retry = (
    await sql(
      `select status,next_action_at>now() as backed_off,attempts from public.automation_jobs where id='${job.id}'`,
    )
  )[0];
  assert.equal(retry.status, "pending");
  assert.equal(retry.backed_off, true);
  evidence.retry = retry;
  const stale = (
    await sql(
      `select public.finish_automation_job('${job.id}','${job.lock_token}') as accepted`,
    )
  )[0];
  assert.equal(stale.accepted, false);
  evidence.staleLeaseRejected = true;
  await sql(
    `update public.autopilot_settings set enabled=false where organization_id='${org}'`,
  );
  assert.equal(
    (await sql(`select * from public.claim_autopilot_job('${org}')`)).length,
    0,
  );
  evidence.pauseStopsClaims = true;
} finally {
  await sql(
    `begin; delete from public.automation_jobs where organization_id='${org}'; delete from public.activities where organization_id='${org}'; delete from public.autopilot_usage where organization_id='${org}'; delete from public.autopilot_settings where organization_id='${org}'; delete from public.organizations where id='${org}'; commit;`,
  );
  evidence.fixturesRemoved = true;
}
evidence.production =
  await sql(`select (select count(*) from public.leads where source='autopilot:brave_search') as persisted_autopilot_leads,
(select count(*) from public.autopilot_candidates) as source_records,
(select count(*) from public.messages where metadata->>'autopilot'='true') as generated_autopilot_drafts,
(select count(*) from public.automation_jobs where kind like 'autopilot_%') as persisted_autopilot_jobs,
(select bool_and(not enabled) from public.autopilot_settings) as paused,
(select min(daily_ai_budget_usd) from public.autopilot_settings) as ai_budget,
public.autopilot_scheduler_status() as scheduler`);
await writeFile(
  new URL("../verification-autopilot.local.json", import.meta.url),
  JSON.stringify(evidence, null, 2),
);
console.log(JSON.stringify(evidence, null, 2));
