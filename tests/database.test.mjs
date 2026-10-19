import { PGlite } from "@electric-sql/pglite";
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { buildMigrationQuery } from "../scripts/migrate.mjs";

const db = new PGlite();
const orgA = "10000000-0000-4000-8000-000000000001";
const orgB = "20000000-0000-4000-8000-000000000002";
const userA = "30000000-0000-4000-8000-000000000003";
const userB = "40000000-0000-4000-8000-000000000004";
const viewer = "50000000-0000-4000-8000-000000000005";
const outsider = "60000000-0000-4000-8000-000000000006";
let leadA, leadB;
before(async () => {
  // Test-only Supabase infrastructure shim; application migrations run unchanged in PostgreSQL.
  await db.exec(`
    create role anon; create role authenticated; create role service_role bypassrls;
    create schema auth;
    create table auth.users(id uuid primary key, raw_user_meta_data jsonb default '{}');
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    grant usage on schema auth to authenticated,anon,service_role;
    create schema storage;
    create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
    create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text);
    alter table storage.objects enable row level security;
    grant usage on schema storage to authenticated;
    grant select,insert on storage.objects to authenticated;
    create function storage.foldername(name text) returns text[] language sql immutable as $$select string_to_array(name,'/')$$;
  `);
  await db.exec(await buildMigrationQuery());
  // Exercise the exact hosted migration runner, including safe re-runs.
  await db.exec(await buildMigrationQuery());
  await db.query(
    `insert into public.organizations(id,name,slug) values($1,'Other test org','test-other')`,
    [orgB],
  );
  for (const id of [userA, userB, viewer, outsider])
    await db.query(`insert into auth.users(id) values($1)`, [id]);
  await db.query(
    `insert into public.organization_members(organization_id,user_id,role) values($1,$2,'owner'),($3,$4,'operator'),($1,$5,'viewer')`,
    [orgA, userA, orgB, userB, viewer],
  );
  leadA = (
    await db.query(
      `insert into public.leads(organization_id,company_name,email) values($1,'Clinic A','a@example.invalid') returning id`,
      [orgA],
    )
  ).rows[0].id;
  leadB = (
    await db.query(
      `insert into public.leads(organization_id,company_name,email) values($1,'Clinic B','b@example.invalid') returning id`,
      [orgB],
    )
  ).rows[0].id;
});
after(async () => {
  if (process.env.VOXA_GENERATE_TYPES === "1") {
    const { generateTypes } = await import("../scripts/generate-types.mjs");
    await generateTypes(db);
  }
  await db.close();
});

async function autopilotFixture() {
  await db.query(
    `update public.autopilot_settings set input_mode='brave_search',enabled=true,storage_rights_confirmed=true,daily_ai_budget_usd=1,daily_target=10 where organization_id=$1`,
    [orgA],
  );
  const run = (
    await db.query(
      `insert into public.autopilot_runs(organization_id,day,targeting) values($1,(now() at time zone 'Europe/Bucharest')::date,'{}') returning *`,
      [orgA],
    )
  ).rows[0];
  await db.query(
    `insert into public.autopilot_usage(organization_id,day) values($1,$2)`,
    [orgA, run.day],
  );
  return run;
}
test("supplied mode schedules selected real-source leads once, excludes demo and suppression, and needs no search rights", async () => {
  await db.exec("begin");
  try {
    const ids = [];
    for (let i = 0; i < 13; i++)
      ids.push(
        (
          await db.query(
            `insert into public.leads(organization_id,company_name,website,email,source) values($1,$2,$3,$4,$5) returning id`,
            [
              orgA,
              `Synthetic test fixture ${i}`,
              `https://supplied-${i}.example.invalid`,
              `supplied-${i}@example.invalid`,
              i === 11 ? "dry-run-demo" : "manual",
            ],
          )
        ).rows[0].id,
      );
    await db.query(
      `insert into public.suppression_list(organization_id,lead_id,channel,identifier,reason) values($1,$2,'all','supplied-12@example.invalid','test exclusion')`,
      [orgA, ids[12]],
    );
    await db.query(
      `update public.autopilot_settings set input_mode='supplied',enabled=true,storage_rights_confirmed=false,daily_ai_budget_usd=1,selected_lead_ids=$2 where organization_id=$1`,
      [orgA, ids],
    );
    await db.query(`select public.schedule_autopilot($1)`, [orgA]);
    await db.query(`select public.schedule_autopilot($1)`, [orgA]);
    assert.equal(
      (
        await db.query(
          `select count(*)::int n from public.autopilot_candidates`,
        )
      ).rows[0].n,
      10,
    );
    assert.equal(
      (
        await db.query(
          `select count(*)::int n from public.automation_jobs where kind='autopilot_discover'`,
        )
      ).rows[0].n,
      0,
    );
    const j = (
      await db.query(`select * from public.claim_autopilot_job($1)`, [orgA])
    ).rows[0];
    assert.ok(
      (
        await db.query(
          `select public.reserve_autopilot_request($1,$2,'ai',0.05) as day`,
          [j.id, j.lock_token],
        )
      ).rows[0].day,
    );
    const c = (
      await db.query(`select * from public.autopilot_candidates where id=$1`, [
        j.payload.candidate_id,
      ])
    ).rows[0];
    const count = (await db.query(`select count(*)::int n from public.leads`))
      .rows[0].n;
    const prospect = JSON.stringify({
      summary: "Explicit fixture research",
      facts: {},
      email: `supplied-${ids.indexOf(c.input_lead_id)}@example.invalid`,
    });
    for (let k = 0; k < 2; k++)
      assert.equal(
        (
          await db.query(
            `select public.commit_autopilot_lead($1,$2,$3,$4) id`,
            [j.id, j.lock_token, c.id, prospect],
          )
        ).rows[0].id,
        c.input_lead_id,
      );
    assert.equal(
      (await db.query(`select count(*)::int n from public.leads`)).rows[0].n,
      count,
    );
    assert.equal(
      (
        await db.query(
          `select qualified from public.autopilot_usage where organization_id=$1`,
          [orgA],
        )
      ).rows[0].qualified,
      1,
    );
    assert.equal(
      (
        await db.query(
          `select count(*)::int n from public.automation_jobs where kind='autopilot_draft'`,
        )
      ).rows[0].n,
      1,
    );
  } finally {
    await db.exec("rollback");
  }
});
test("supplied lead dedup excludes itself but includes other contacts, suppressed identifiers and rejects", async () => {
  await db.exec("begin");
  try {
    await db.query(
      `update public.leads set website='https://self.example.invalid',phone='0722 555 666' where id=$1`,
      [leadA],
    );
    const query = `select public.autopilot_supplied_duplicate($1,'https://www.self.example.invalid','a@example.invalid','+40722555666',$2) dupe`;
    assert.equal((await db.query(query, [orgA, leadA])).rows[0].dupe, false);
    await db.query(
      `insert into public.lead_contacts(organization_id,lead_id,email) values($1,$2,'A@example.invalid')`,
      [orgA, leadA],
    );
    assert.equal((await db.query(query, [orgA, leadA])).rows[0].dupe, false);
    const other = (
      await db.query(
        `insert into public.leads(organization_id,company_name) values($1,'Other explicit test fixture') returning id`,
        [orgA],
      )
    ).rows[0].id;
    await db.query(
      `insert into public.lead_contacts(organization_id,lead_id,phone) values($1,$2,'0040722555666')`,
      [orgA, other],
    );
    assert.equal((await db.query(query, [orgA, leadA])).rows[0].dupe, true);
  } finally {
    await db.exec("rollback");
  }
});
async function autopilotResearchJob(run, suffix = "one") {
  const c = (
    await db.query(
      `insert into public.autopilot_candidates(organization_id,run_id,source_url,domain,provider_title,fit_score,confidence) values($1,$2,$3,$4,'Explicit synthetic test',100,75) returning *`,
      [
        orgA,
        run.id,
        `https://${suffix}.example.invalid`,
        `${suffix}.example.invalid`,
      ],
    )
  ).rows[0];
  const j = (
    await db.query(
      `insert into public.automation_jobs(organization_id,kind,idempotency_key,payload,status,attempts,locked_until,lock_token,max_attempts) values($1,'autopilot_research',$2,$3,'running',1,now()+interval '5 minutes',gen_random_uuid(),2) returning *`,
      [orgA, `aptest:${suffix}`, JSON.stringify({ candidate_id: c.id })],
    )
  ).rows[0];
  return { c, j };
}
test("autopilot checks all leads, contact records and suppression with canonical phone", async () => {
  await db.exec("begin");
  try {
    await db.query(
      `insert into public.leads(organization_id,company_name,website,phone,do_not_contact,status) values($1,'Suppressed fixture','https://www.fixture.example.invalid/contact','0722 111 222',true,'DO_NOT_CONTACT')`,
      [orgA],
    );
    for (const phone of ["+40722111222", "0040722111222", "40722111222"])
      assert.equal(
        (
          await db.query(
            `select public.autopilot_duplicate($1,'https://other.example.invalid','',$2) as dupe`,
            [orgA, phone],
          )
        ).rows[0].dupe,
        true,
      );
    assert.equal(
      (
        await db.query(
          `select public.autopilot_duplicate($1,'https://fixture.example.invalid/path','','') as dupe`,
          [orgA],
        )
      ).rows[0].dupe,
      true,
    );
    await db.query(
      `insert into public.lead_contacts(organization_id,lead_id,email) values($1,$2,'Contact@fixture.example.invalid')`,
      [orgA, leadA],
    );
    assert.equal(
      (
        await db.query(
          `select public.autopilot_duplicate($1,'https://new.example.invalid',' contact@fixture.example.invalid ','') as dupe`,
          [orgA],
        )
      ).rows[0].dupe,
      true,
    );
    await db.query(
      `insert into public.suppression_list(organization_id,channel,identifier,reason) values($1,'all','blocked@fixture.example.invalid','test')`,
      [orgA],
    );
    assert.equal(
      (
        await db.query(
          `select public.autopilot_duplicate($1,'https://new.example.invalid','blocked@fixture.example.invalid','') as dupe`,
          [orgA],
        )
      ).rows[0].dupe,
      true,
    );
  } finally {
    await db.exec("rollback");
  }
});
test("autopilot concurrent claims are distinct and stale checkpoints fail", async () => {
  await db.exec("begin");
  try {
    const run = await autopilotFixture();
    await db.query(`select public.schedule_autopilot($1)`, [orgA]);
    await db.query(`select public.schedule_autopilot($1)`, [orgA]);
    assert.equal(
      (
        await db.query(
          `select count(*)::int n from public.automation_jobs where kind='autopilot_discover'`,
        )
      ).rows[0].n,
      1,
    );
    const claims = await Promise.all([
      db.query(`select * from public.claim_autopilot_job($1)`, [orgA]),
      db.query(`select * from public.claim_autopilot_job($1)`, [orgA]),
    ]);
    assert.equal(claims.flatMap((r) => r.rows).length, 1);
    const { c, j } = await autopilotResearchJob(run);
    await assert.rejects(
      db.query(
        `select public.checkpoint_autopilot($1,gen_random_uuid(),$2,'{"state":"rejected"}')`,
        [j.id, c.id],
      ),
      /Invalid worker lease/,
    );
  } finally {
    await db.exec("rollback");
  }
});
test("autopilot reserves budget atomically, retains uncertain costs, and defers without burning retries", async () => {
  await db.exec("begin");
  try {
    const run = await autopilotFixture();
    const a = await autopilotResearchJob(run, "budget-a");
    const b = await autopilotResearchJob(run, "budget-b");
    const results = await Promise.all(
      [a, b].map(({ j }) =>
        db.query(
          `select public.reserve_autopilot_request($1,$2,'ai',0.6) as day`,
          [j.id, j.lock_token],
        ),
      ),
    );
    assert.equal(results.filter((r) => r.rows[0].day !== null).length, 1);
    assert.equal(
      Number(
        (
          await db.query(
            `select ai_cost_usd from public.autopilot_usage where organization_id=$1`,
            [orgA],
          )
        ).rows[0].ai_cost_usd,
      ),
      0.6,
    );
    await db.query(`select public.defer_autopilot_budget($1,$2)`, [
      b.j.id,
      b.j.lock_token,
    ]);
    const deferred = (
      await db.query(`select * from public.automation_jobs where id=$1`, [
        b.j.id,
      ])
    ).rows[0];
    assert.equal(deferred.status, "pending");
    assert.equal(deferred.attempts, 0);
    assert.ok(new Date(deferred.next_action_at) > new Date());
  } finally {
    await db.exec("rollback");
  }
});
test("autopilot qualified lead cap and duplicate commits survive repeated workers", async () => {
  await db.exec("begin");
  try {
    const run = await autopilotFixture();
    const ids = [];
    for (let i = 0; i < 12; i++) {
      const { c, j } = await autopilotResearchJob(run, `quota-${i}`);
      const prospect = {
        company_name: `Explicit synthetic quota fixture ${i}`,
        city: "București",
        email: `quota-${i}@example.invalid`,
        facts: {},
        summary: "test",
      };
      const lead = (
        await db.query(
          `select public.commit_autopilot_lead($1,$2,$3,$4) as id`,
          [j.id, j.lock_token, c.id, JSON.stringify(prospect)],
        )
      ).rows[0].id;
      if (lead) ids.push(lead);
      assert.equal(
        (
          await db.query(
            `select public.commit_autopilot_lead($1,$2,$3,$4) as id`,
            [j.id, j.lock_token, c.id, JSON.stringify(prospect)],
          )
        ).rows[0].id,
        lead,
      );
    }
    assert.equal(ids.length, 10);
    assert.equal(
      (
        await db.query(
          `select qualified from public.autopilot_usage where organization_id=$1`,
          [orgA],
        )
      ).rows[0].qualified,
      10,
    );
    assert.equal(
      (
        await db.query(
          `select count(*)::int n from public.automation_jobs where kind='autopilot_draft'`,
        )
      ).rows[0].n,
      10,
    );
  } finally {
    await db.exec("rollback");
  }
});
test("autopilot creates exactly one unapproved draft with no campaign or delivery", async () => {
  await db.exec("begin");
  try {
    const run = await autopilotFixture();
    const { c, j } = await autopilotResearchJob(run, "draft-only");
    const lead = (
      await db.query(
        `select public.commit_autopilot_lead($1,$2,$3,'{"company_name":"Explicit draft test","city":"București","facts":{}}') as id`,
        [j.id, j.lock_token, c.id],
      )
    ).rows[0].id;
    const job = (
      await db.query(`select * from public.claim_autopilot_job($1)`, [orgA])
    ).rows[0];
    const draft = {
      subject: "Test sintetic",
      body: "Ciornă exclusiv pentru verificare. Nicio livrare.",
    };
    const args = [job.id, job.lock_token, c.id, JSON.stringify(draft)];
    const first = (
      await db.query(
        `select public.commit_autopilot_draft($1,$2,$3,$4) as id`,
        args,
      )
    ).rows[0].id;
    const second = (
      await db.query(
        `select public.commit_autopilot_draft($1,$2,$3,$4) as id`,
        args,
      )
    ).rows[0].id;
    assert.equal(first, second);
    const m = (
      await db.query(`select * from public.messages where id=$1`, [first])
    ).rows[0];
    assert.equal(m.lead_id, lead);
    assert.equal(m.status, "draft");
    assert.equal(m.campaign_id, null);
    assert.equal(m.approved_at, null);
    assert.equal(m.sent_at, null);
    assert.equal(m.provider_message_id, null);
  } finally {
    await db.exec("rollback");
  }
});
test("autopilot failures back off and reach terminal failure; pause blocks claims", async () => {
  await db.exec("begin");
  try {
    const run = await autopilotFixture();
    const { j } = await autopilotResearchJob(run, "retry");
    await db.query(
      `select public.finish_automation_job($1,$2,'Provider HTTP 429')`,
      [j.id, j.lock_token],
    );
    let row = (
      await db.query(`select * from public.automation_jobs where id=$1`, [j.id])
    ).rows[0];
    assert.equal(row.status, "pending");
    assert.ok(new Date(row.next_action_at) > new Date());
    await db.query(
      `update public.automation_jobs set next_action_at=now() where id=$1`,
      [j.id],
    );
    row = (
      await db.query(`select * from public.claim_autopilot_job($1)`, [orgA])
    ).rows[0];
    await db.query(
      `select public.finish_automation_job($1,$2,'Provider HTTP 429')`,
      [row.id, row.lock_token],
    );
    assert.equal(
      (
        await db.query(
          `select status from public.automation_jobs where id=$1`,
          [j.id],
        )
      ).rows[0].status,
      "failed",
    );
    await db.query(
      `update public.autopilot_settings set enabled=false where organization_id=$1`,
      [orgA],
    );
    assert.equal(
      (await db.query(`select * from public.claim_autopilot_job($1)`, [orgA]))
        .rows.length,
      0,
    );
  } finally {
    await db.exec("rollback");
  }
});
test("autopilot settings and privileged functions reject direct tenant writes", async () => {
  await asUser(userA, async () => {
    assert.equal(
      (await db.query(`select * from public.autopilot_settings`)).rows.length,
      1,
    );
    await assert.rejects(
      db.query(`update public.autopilot_settings set enabled=true`),
      /permission denied/,
    );
  });
  await asUser(userA, async () => {
    await assert.rejects(
      db.query(`select public.claim_autopilot_job($1)`, [orgA]),
      /permission denied/,
    );
  });
});

test("campaign audience rejects mismatched niche, city, source, and score", async () => {
  await db.exec("begin");
  try {
    const c = (
      await db.query(
        `insert into public.campaigns(organization_id,name,niche,cities,target_filters) values($1,'Audience test','Stomatologie',array['București'],'{"min_score":"80","source":"CSV"}') returning id`,
        [orgA],
      )
    ).rows[0].id;
    const matches = async () =>
      (
        await db.query(
          "select private.campaign_matches(c,l) as matches from public.campaigns c,public.leads l where c.id=$1 and l.id=$2",
          [c, leadA],
        )
      ).rows[0].matches;
    assert.equal(await matches(), false);
    await db.query(
      `update public.leads set niche='Stomatologie',city='București',lead_score=85,source='CSV' where id=$1`,
      [leadA],
    );
    assert.equal(await matches(), true);
    await db.query(`update public.leads set lead_score=79 where id=$1`, [
      leadA,
    ]);
    assert.equal(await matches(), false);
  } finally {
    await db.exec("rollback");
  }
});

test("one active campaign and dry-run delivery enforce lifecycle safety", async () => {
  await db.exec("begin");
  try {
    await db.query(`select set_config('request.jwt.claim.sub',$1,true)`, [
      userA,
    ]);
    const lead = (
      await db.query(
        `insert into public.leads(organization_id,company_name,email,niche,city,lead_score,source) values($1,'Clinic hardening','hardening@example.invalid','Stomatologie','București',90,'audit') returning id`,
        [orgA],
      )
    ).rows[0].id;
    const first = (
      await db.query(
        `insert into public.campaigns(organization_id,name,status,mode,weekdays_only,window_start,window_end) values($1,'First journey','active','automatic',false,'00:00','23:59:59') returning id`,
        [orgA],
      )
    ).rows[0].id;
    const second = (
      await db.query(
        `insert into public.campaigns(organization_id,name,status,mode,weekdays_only,window_start,window_end) values($1,'Second journey','active','automatic',false,'00:00','23:59:59') returning id`,
        [orgA],
      )
    ).rows[0].id;
    await db.query(`select public.assign_leads_to_campaign($1,$2,$3)`, [
      orgA,
      first,
      [lead],
    ]);
    await db.query(`select public.assign_leads_to_campaign($1,$2,$3)`, [
      orgA,
      second,
      [lead],
    ]);
    const active = (
      await db.query(
        `select campaign_id from public.campaign_leads where lead_id=$1 and stopped_at is null`,
        [lead],
      )
    ).rows;
    assert.deepEqual(
      active.map((row) => row.campaign_id),
      [second],
    );

    const initial = (
      await db.query(
        `insert into public.messages(organization_id,lead_id,campaign_id,direction,body,status,idempotency_key,follow_up_number) values($1,$2,$3,'outbound','Dry run','queued','dry-run-initial',0) returning id`,
        [orgA, lead, first],
      )
    ).rows[0].id;
    const simulated = (
      await db.query(`select * from public.simulate_outbound_message($1)`, [
        initial,
      ])
    ).rows[0];
    assert.equal(simulated.status, "sent");
    assert.equal(simulated.provider, "local-dry-run");
    assert.equal(simulated.metadata.simulated, true);

    await db.exec("savepoint duplicate_check");
    await assert.rejects(
      db.query(
        `insert into public.messages(organization_id,lead_id,campaign_id,direction,body,status,idempotency_key,follow_up_number) values($1,$2,$3,'outbound','Duplicate','queued','dry-run-duplicate',0)`,
        [orgA, lead, second],
      ),
      /initial_outreach_once|unique constraint/,
    );
    await db.exec("rollback to savepoint duplicate_check");

    await db.query(
      `update public.leads set status='HUMAN_REQUIRED' where id=$1`,
      [lead],
    );
    const inbound = (
      await db.query(
        `insert into public.messages(organization_id,lead_id,direction,body,status,idempotency_key,received_at) values($1,$2,'inbound','Întrebare contractuală','received','human-inbound',now()) returning id`,
        [orgA, lead],
      )
    ).rows[0].id;
    const humanReply = (
      await db.query(
        `insert into public.messages(organization_id,lead_id,campaign_id,in_reply_to,direction,body,status,idempotency_key,metadata) values($1,$2,$3,$4,'outbound','Răspuns verificat','approved','human-reply','{"human_approved":true}') returning id`,
        [orgA, lead, second, inbound],
      )
    ).rows[0].id;
    assert.equal(
      (
        await db.query(`select * from public.simulate_outbound_message($1)`, [
          humanReply,
        ])
      ).rows.length,
      1,
    );

    await db.query(`update public.leads set status='WON' where id=$1`, [lead]);
    const onboarding = (
      await db.query(
        `insert into public.messages(organization_id,lead_id,direction,body,status,idempotency_key,metadata) values($1,$2,'outbound','Onboarding','queued','transactional-onboarding','{"transactional_onboarding":true}') returning id`,
        [orgA, lead],
      )
    ).rows[0].id;
    assert.equal(
      (
        await db.query(`select * from public.simulate_outbound_message($1)`, [
          onboarding,
        ])
      ).rows.length,
      1,
    );
  } finally {
    await db.exec("rollback");
  }
});

async function asUser(id, fn) {
  await db.exec("begin; set local role authenticated;");
  await db.query(`select set_config('request.jwt.claim.sub',$1,true)`, [id]);
  try {
    return await fn();
  } finally {
    await db.exec("rollback");
  }
}

test("all application tables have RLS and anonymous privileges revoked", async () => {
  const rows = (
    await db.query(
      `select c.relname,c.relrowsecurity,has_table_privilege('anon',c.oid,'select') as anon_select from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='r'`,
    )
  ).rows;
  assert.equal(rows.length, 30);
  assert.ok(rows.every((r) => r.relrowsecurity && !r.anon_select));
});
test("membership isolates reads, profiles, and forged organization filters", async () => {
  await asUser(userA, async () => {
    const leads = (await db.query("select id from public.leads")).rows;
    assert.deepEqual(
      leads.map((l) => l.id),
      [leadA],
    );
    assert.equal(
      (
        await db.query("select id from public.leads where organization_id=$1", [
          orgB,
        ])
      ).rows.length,
      0,
    );
    assert.deepEqual(
      (await db.query("select id from public.profiles order by id")).rows.map(
        (r) => r.id,
      ),
      [userA, viewer],
    );
  });
  await asUser(outsider, async () =>
    assert.equal((await db.query("select * from public.leads")).rows.length, 0),
  );
});
test("cross-organization insert is denied", async () => {
  await assert.rejects(
    asUser(userA, () =>
      db.query(
        `insert into public.leads(organization_id,company_name) values($1,'Forbidden')`,
        [orgB],
      ),
    ),
    /row-level security/,
  );
});
test("viewers cannot write and users cannot self-promote", async () => {
  await assert.rejects(
    asUser(viewer, () =>
      db.query(
        `insert into public.leads(organization_id,company_name) values($1,'Forbidden')`,
        [orgA],
      ),
    ),
    /row-level security/,
  );
  await assert.rejects(
    asUser(userA, () =>
      db.query(
        `update public.organization_members set role='owner' where user_id=$1`,
        [viewer],
      ),
    ),
    /permission denied/,
  );
  await assert.rejects(
    asUser(userA, () => db.exec(`delete from public.activities`)),
    /permission denied/,
  );
});
test("tenant foreign keys prevent cross-organization relationships", async () => {
  await assert.rejects(
    asUser(userA, () =>
      db.query(
        `insert into public.lead_contacts(organization_id,lead_id,name) values($1,$2,'Invalid')`,
        [orgA, leadB],
      ),
    ),
    /foreign key/,
  );
});
test("lead deduplication normalizes email case and whitespace", async () => {
  await assert.rejects(
    asUser(userA, () =>
      db.query(
        `insert into public.leads(organization_id,company_name,email) values($1,'Duplicate',' A@EXAMPLE.INVALID ')`,
        [orgA],
      ),
    ),
    /unique constraint/,
  );
});
test("profile creation does not auto-enroll outsiders", async () => {
  assert.equal(
    (await db.query("select * from public.profiles where id=$1", [outsider]))
      .rows.length,
    1,
  );
  assert.equal(
    (
      await db.query(
        "select * from public.organization_members where user_id=$1",
        [outsider],
      )
    ).rows.length,
    0,
  );
});
test("campaign activation requires a signed-in admin", async () => {
  await assert.rejects(
    db.query(
      `insert into public.campaigns(organization_id,name,status) values($1,'Must fail','active')`,
      [orgA],
    ),
    /signed-in/,
  );
  await asUser(userA, async () => {
    const row = (
      await db.query(
        `insert into public.campaigns(organization_id,name,status) values($1,'Test','active') returning activated_by`,
        [orgA],
      )
    ).rows[0];
    assert.equal(row.activated_by, userA);
  });
});
test("private storage is isolated by organization prefix", async () => {
  await db.query(
    `insert into storage.objects(bucket_id,name) values('voxa-demos',$1),('voxa-demos',$2)`,
    [`${orgA}/test.mp3`, `${orgB}/test.mp3`],
  );
  await asUser(userA, async () =>
    assert.equal(
      (await db.query("select * from storage.objects")).rows.length,
      1,
    ),
  );
  await assert.rejects(
    asUser(userA, () =>
      db.query(
        `insert into storage.objects(bucket_id,name) values('voxa-knowledge',$1)`,
        [`${orgB}/forbidden.txt`],
      ),
    ),
    /row-level security/,
  );
});
test("knowledge changes retain immutable version history", async () => {
  await asUser(userA, async () => {
    const before = (
      await db.query(
        "select count(*)::int n from public.knowledge_base_versions",
      )
    ).rows[0].n;
    await db.query(
      `update public.knowledge_base_documents set content='Revised for test' where organization_id=$1`,
      [orgA],
    );
    assert.equal(
      (
        await db.query(
          "select version from public.knowledge_base_versions order by version",
        )
      ).rows.length,
      before + 1,
    );
  });
});
test("job claims cannot duplicate work, stale tokens cannot finish it, failures retry", async () => {
  await db.query(
    `insert into public.automation_jobs(organization_id,kind,idempotency_key) values($1,'daily_summary','test-job')`,
    [orgA],
  );
  const job = (await db.query("select * from public.claim_automation_jobs(10)"))
    .rows[0];
  assert.equal(job.attempts, 1);
  assert.equal(
    (await db.query("select * from public.claim_automation_jobs(10)")).rows
      .length,
    0,
  );
  assert.equal(
    (
      await db.query("select public.finish_automation_job($1,$2)", [
        job.id,
        outsider,
      ])
    ).rows[0].finish_automation_job,
    false,
  );
  assert.equal(
    (
      await db.query("select public.finish_automation_job($1,$2,$3)", [
        job.id,
        job.lock_token,
        "Transient test error",
      ])
    ).rows[0].finish_automation_job,
    true,
  );
  const retried = (
    await db.query("select * from public.automation_jobs where id=$1", [job.id])
  ).rows[0];
  assert.equal(retried.status, "pending");
  assert.ok(new Date(retried.next_action_at) > new Date());
  await assert.rejects(
    asUser(userA, () =>
      db.query("select * from public.claim_automation_jobs(10)"),
    ),
    /permission denied/,
  );
});
test("do-not-contact cancels queued outbound messages and jobs", async () => {
  await db.exec("begin");
  try {
    await db.query(
      `insert into public.messages(organization_id,lead_id,direction,body,status,idempotency_key) values($1,$2,'outbound','Test','queued','stop-test')`,
      [orgA, leadA],
    );
    await db.query(
      `insert into public.automation_jobs(organization_id,lead_id,kind,idempotency_key) values($1,$2,'send_due_messages','stop-test')`,
      [orgA, leadA],
    );
    await db.query(`update public.leads set do_not_contact=true where id=$1`, [
      leadA,
    ]);
    assert.equal(
      (
        await db.query(
          `select status from public.messages where idempotency_key='stop-test'`,
        )
      ).rows[0].status,
      "cancelled",
    );
    assert.equal(
      (
        await db.query(
          `select status from public.automation_jobs where idempotency_key='stop-test'`,
        )
      ).rows[0].status,
      "cancelled",
    );
    assert.equal(
      (await db.query("select status from public.leads where id=$1", [leadA]))
        .rows[0].status,
      "DO_NOT_CONTACT",
    );
  } finally {
    await db.exec("rollback");
  }
});
test("message reservation enforces campaign caps and fences old uncertain sends", async () => {
  await db.exec("begin");
  try {
    await db.query(`select set_config('request.jwt.claim.sub',$1,true)`, [
      userA,
    ]);
    const c = (
      await db.query(
        `insert into public.campaigns(organization_id,name,status,mode,daily_cap,weekdays_only,window_start,window_end) values($1,'Cap verification','active','automatic',1,false,'00:00','23:59:59') returning id`,
        [orgA],
      )
    ).rows[0].id;
    const make = async (key) =>
      (
        await db.query(
          `insert into public.messages(organization_id,lead_id,campaign_id,direction,body,status,idempotency_key) values($1,$2,$3,'outbound','Test','queued',$4) returning id`,
          [orgA, leadA, c, key],
        )
      ).rows[0].id;
    const m1 = await make("cap-first");
    const m2 = await make("cap-second");
    assert.equal(
      (
        await db.query("select * from public.reserve_outbound_message($1)", [
          m1,
        ])
      ).rows.length,
      1,
    );
    assert.equal(
      (
        await db.query("select * from public.reserve_outbound_message($1)", [
          m1,
        ])
      ).rows.length,
      1,
      "same message reuses its provider idempotency key",
    );
    await db.query(
      "update public.campaigns set next_send_at=null where id=$1",
      [c],
    );
    assert.equal(
      (
        await db.query("select * from public.reserve_outbound_message($1)", [
          m2,
        ])
      ).rows.length,
      0,
      "daily cap holds",
    );
    await db.query(
      `update public.messages set reserved_at=now()-interval '24 hours' where id=$1`,
      [m1],
    );
    assert.equal(
      (
        await db.query("select * from public.reserve_outbound_message($1)", [
          m1,
        ])
      ).rows.length,
      0,
      "expired provider idempotency windows never retry automatically",
    );
  } finally {
    await db.exec("rollback");
  }
});
test("unapproved messages and followups after an inbound reply cannot reserve delivery", async () => {
  await db.exec("begin");
  try {
    await db.query(`select set_config('request.jwt.claim.sub',$1,true)`, [
      userA,
    ]);
    const c = (
      await db.query(
        `insert into public.campaigns(organization_id,name,status,mode,weekdays_only,window_start,window_end) values($1,'Approval verification','active','approval_required',false,'00:00','23:59:59') returning id`,
        [orgA],
      )
    ).rows[0].id;
    const m = (
      await db.query(
        `insert into public.messages(organization_id,lead_id,campaign_id,direction,body,status,idempotency_key,follow_up_number) values($1,$2,$3,'outbound','Test','queued','approval-test',1) returning id`,
        [orgA, leadA, c],
      )
    ).rows[0].id;
    assert.equal(
      (await db.query("select * from public.reserve_outbound_message($1)", [m]))
        .rows.length,
      0,
    );
    await db.query(`update public.messages set approved_by=$1 where id=$2`, [
      userA,
      m,
    ]);
    await db.query(
      `insert into public.messages(organization_id,lead_id,direction,body,status,idempotency_key) values($1,$2,'inbound','Salut','received','reply-test')`,
      [orgA, leadA],
    );
    assert.equal(
      (await db.query("select * from public.reserve_outbound_message($1)", [m]))
        .rows.length,
      0,
    );
  } finally {
    await db.exec("rollback");
  }
});
test("organization-scoped workers do not claim another tenant and deferral preserves retry budget", async () => {
  await db.exec("begin");
  try {
    await db.query(
      `insert into public.automation_jobs(organization_id,kind,idempotency_key,next_action_at) values($1,'daily_summary','scoped-a',now()-interval '1 hour'),($2,'daily_summary','scoped-b',now()-interval '2 hours')`,
      [orgA, orgB],
    );
    const job = (
      await db.query("select * from public.claim_organization_job($1)", [orgA])
    ).rows[0];
    assert.equal(job.organization_id, orgA);
    assert.equal(
      (
        await db.query("select public.defer_automation_job($1,$2)", [
          job.id,
          job.lock_token,
        ])
      ).rows[0].defer_automation_job,
      true,
    );
    const deferred = (
      await db.query("select * from public.automation_jobs where id=$1", [
        job.id,
      ])
    ).rows[0];
    assert.equal(deferred.attempts, 0);
    assert.equal(deferred.status, "pending");
  } finally {
    await db.exec("rollback");
  }
});
test("delivery retries stay in today's window and respect closing, weekends and Bucharest DST", async () => {
  const cases = [
    ["2026-10-19T08:15:00+03:00", true, "2026-10-19T08:15:00+03:00"],
    ["2026-10-19T11:59:00+03:00", true, "2026-10-19T11:59:00+03:00"],
    ["2026-10-19T07:45:00+03:00", true, "2026-10-19T08:00:00+03:00"],
    ["2026-10-19T12:00:00+03:00", true, "2026-10-20T08:00:00+03:00"],
    ["2026-10-19T12:05:00+03:00", true, "2026-10-20T08:00:00+03:00"],
    ["2026-10-23T12:05:00+03:00", true, "2026-10-26T08:00:00+02:00"],
    ["2026-10-24T09:00:00+03:00", true, "2026-10-26T08:00:00+02:00"],
    ["2026-10-25T09:00:00+02:00", true, "2026-10-26T08:00:00+02:00"],
    ["2026-10-24T09:00:00+03:00", false, "2026-10-24T09:00:00+03:00"],
    ["2027-03-26T12:05:00+02:00", true, "2027-03-29T08:00:00+03:00"],
  ];
  for (const [ready, weekdays, expected] of cases) {
    const { rows } = await db.query(
      "select private.delivery_retry_at($1,'08:00','12:00',$2) as retry",
      [ready, weekdays],
    );
    assert.equal(
      new Date(rows[0].retry).toISOString(),
      new Date(expected).toISOString(),
      ready,
    );
  }
});

test("deferred deliveries honor mailbox pacing, fence expired leases and remain service-only", async () => {
  await db.exec("begin");
  try {
    await db.query("select set_config('request.jwt.claim.sub',$1,true)", [
      userA,
    ]);
    const campaign = (
      await db.query(
        "insert into public.campaigns(organization_id,name,sender_identity,status,mode,weekdays_only,window_start,window_end) values($1,'Retry fixture','retry@gmail.com','active','automatic',false,'08:00','12:00') returning id",
        [orgA],
      )
    ).rows[0].id;
    const mailbox = (
      await db.query(
        "insert into public.gmail_accounts(organization_id,email,google_subject,encrypted_refresh_token,campaign_id,next_send_at) values($1,'retry@gmail.com','retry-fixture','encrypted-fixture',$2,(((now() at time zone 'Europe/Bucharest')::date+7)+time '08:30') at time zone 'Europe/Bucharest') returning next_send_at",
        [orgA, campaign],
      )
    ).rows[0];
    const message = (
      await db.query(
        "insert into public.messages(organization_id,lead_id,campaign_id,direction,body,status,idempotency_key) values($1,$2,$3,'outbound','Retry fixture','queued','retry-fixture') returning id",
        [orgA, leadA, campaign],
      )
    ).rows[0].id;
    const job = (
      await db.query(
        "insert into public.automation_jobs(organization_id,kind,idempotency_key,payload,status,attempts,locked_until,lock_token) values($1,'send_due_messages','retry-fixture',jsonb_build_object('message_id',$2::text),'running',1,now()+interval '5 minutes',gen_random_uuid()) returning id,lock_token",
        [orgA, message],
      )
    ).rows[0];
    await db.exec("set local role service_role");
    assert.equal(
      (
        await db.query(
          "select public.defer_automation_job($1,gen_random_uuid()) ok",
          [job.id],
        )
      ).rows[0].ok,
      false,
    );
    assert.equal(
      (
        await db.query("select public.defer_automation_job($1,$2) ok", [
          job.id,
          job.lock_token,
        ])
      ).rows[0].ok,
      true,
    );
    assert.equal(
      (
        await db.query("select public.defer_automation_job($1,$2) ok", [
          job.id,
          job.lock_token,
        ])
      ).rows[0].ok,
      false,
      "a released lease cannot defer the job twice",
    );
    const deferred = (
      await db.query(
        "select status,attempts,next_action_at,lock_token,locked_until from public.automation_jobs where id=$1",
        [job.id],
      )
    ).rows[0];
    assert.equal(
      new Date(deferred.next_action_at).toISOString(),
      new Date(mailbox.next_send_at).toISOString(),
    );
    assert.equal(deferred.status, "pending");
    assert.equal(deferred.attempts, 0);
    assert.equal(deferred.lock_token, null);
    assert.equal(deferred.locked_until, null);
    await db.query(
      "update public.automation_jobs set status='running',attempts=1,lock_token=$2,locked_until=now()-interval '1 second' where id=$1",
      [job.id, job.lock_token],
    );
    assert.equal(
      (
        await db.query("select public.defer_automation_job($1,$2) ok", [
          job.id,
          job.lock_token,
        ])
      ).rows[0].ok,
      false,
      "expired workers cannot reschedule deliveries",
    );
    await db.exec("reset role");
    for (const role of ["anon", "authenticated"]) {
      const { rows } = await db.query(
        "select has_function_privilege($1,'public.defer_automation_job(uuid,uuid)','execute') can_defer, has_function_privilege($1,'private.delivery_retry_at(timestamptz,time,time,boolean)','execute') can_plan",
        [role],
      );
      assert.equal(rows[0].can_defer, false);
      assert.equal(rows[0].can_plan, false);
    }
  } finally {
    await db.exec("rollback");
  }
});

test("scheduler and payment processing remain idempotent on repeated calls", async () => {
  await db.exec("begin");
  try {
    await db.query(`select set_config('request.jwt.claim.sub',$1,true)`, [
      userA,
    ]);
    const c = (
      await db.query(
        `insert into public.campaigns(organization_id,name,status) values($1,'Scheduler verification','active') returning id`,
        [orgA],
      )
    ).rows[0].id;
    await db.query(
      "insert into public.campaign_leads(organization_id,campaign_id,lead_id) values($1,$2,$3)",
      [orgA, c, leadA],
    );
    await db.query(`select public.schedule_due_jobs($1,'log')`, [orgA]);
    await db.query(`select public.schedule_due_jobs($1,'log')`, [orgA]);
    assert.equal(
      (
        await db.query(
          `select * from public.automation_jobs where idempotency_key=$1`,
          [`initial:${c}:${leadA}`],
        )
      ).rows.length,
      1,
    );
    const first = (
      await db.query(
        `select public.apply_payment($1,$2,'checkout-test',499,'RON')`,
        [orgA, leadA],
      )
    ).rows[0].apply_payment;
    const second = (
      await db.query(
        `select public.apply_payment($1,$2,'checkout-test',499,'RON')`,
        [orgA, leadA],
      )
    ).rows[0].apply_payment;
    assert.equal(first, second);
    assert.equal(
      (
        await db.query(`select revenue_won from public.leads where id=$1`, [
          leadA,
        ])
      ).rows[0].revenue_won,
      "499.00",
    );
    assert.equal(
      (
        await db.query(
          `select * from public.notifications where idempotency_key='payment:checkout-test'`,
        )
      ).rows.length,
      1,
    );
  } finally {
    await db.exec("rollback");
  }
});

test("website-free supplied jobs persist null sources, remain distinct, and can produce only a draft", async () => {
  await db.exec("begin");
  try {
    const ids = [];
    for (let i = 0; i < 2; i++)
      ids.push(
        (
          await db.query(
            `insert into public.leads(organization_id,company_name,niche,city,country,email,source) values($1,$2,'dental','Brașov','RO',$3,'CSV') returning id`,
            [orgA, `Provided clinic ${i}`, `no-site-${i}@example.invalid`],
          )
        ).rows[0].id,
      );
    await db.query(
      `update public.autopilot_settings set enabled=true,input_mode='supplied',require_website=false,daily_ai_budget_usd=1,selected_lead_ids=$2 where organization_id=$1`,
      [orgA, ids],
    );
    await db.query(`select public.schedule_autopilot($1)`, [orgA]);
    await db.query(`select public.schedule_autopilot($1)`, [orgA]);
    const candidates = (
      await db.query(
        `select * from public.autopilot_candidates where input_lead_id=any($1)`,
        [ids],
      )
    ).rows;
    assert.equal(candidates.length, 2);
    assert.ok(
      candidates.every((c) => c.source_url === null && c.domain === null),
    );
    const job = (
      await db.query(`select * from public.claim_autopilot_job($1)`, [orgA])
    ).rows[0];
    const c = candidates.find((c) => c.input_lead_id === job.lead_id);
    await db.query(`select public.checkpoint_autopilot($1,$2,$3,$4::jsonb)`, [
      job.id,
      job.lock_token,
      c.id,
      JSON.stringify({
        fit_score: 85,
        confidence: 0,
        research: {
          evidence: null,
          source_urls: [],
          fact_provenance: "user_supplied_unverified",
        },
      }),
    ]);
    const committed = (
      await db.query(
        `select public.commit_autopilot_lead($1,$2,$3,$4::jsonb) as id`,
        [
          job.id,
          job.lock_token,
          c.id,
          JSON.stringify({
            company_name: "Provided clinic",
            city: "Brașov",
            email: `no-site-${ids.indexOf(c.input_lead_id)}@example.invalid`,
            phone: null,
            facts: { services: null, hours: null },
            summary: "Fără site; date furnizate.",
          }),
        ],
      )
    ).rows[0].id;
    assert.equal(committed, c.input_lead_id);
    assert.equal(
      (
        await db.query(
          `select confidence from public.autopilot_candidates where id=$1`,
          [c.id],
        )
      ).rows[0].confidence,
      0,
    );
    assert.equal(
      (
        await db.query(
          `select count(*)::int as n from public.messages where lead_id=any($1)`,
          [ids],
        )
      ).rows[0].n,
      0,
    );
    assert.equal(
      (
        await db.query(
          `select count(*)::int as n from public.automation_jobs where kind='autopilot_draft' and lead_id=$1`,
          [committed],
        )
      ).rows[0].n,
      1,
    );
  } finally {
    await db.exec("rollback");
  }
});
test("trash is tenant-scoped, recoverable, cancels worker leases, and never resumes delivery", async () => {
  await db.exec("begin");
  try {
    const id = (
      await db.query(
        `insert into public.leads(organization_id,company_name,email) values($1,'Trash fixture','trash-fixture@example.invalid') returning id`,
        [orgA],
      )
    ).rows[0].id;
    await db.query(
      `update public.autopilot_settings set selected_lead_ids=array[$2::uuid] where organization_id=$1`,
      [orgA, id],
    );
    const job = (
      await db.query(
        `insert into public.automation_jobs(organization_id,lead_id,kind,idempotency_key) values($1,$2,'enrich_new_leads','trash-worker') returning id`,
        [orgA, id],
      )
    ).rows[0].id;
    const claimed = (
      await db.query(`select * from public.claim_organization_job($1)`, [orgA])
    ).rows.find((j) => j.id === job);
    assert.ok(claimed);
    assert.equal(
      (
        await db.query(`select public.trash_leads($1,$2,$3) as n`, [
          orgA,
          [id],
          userA,
        ])
      ).rows[0].n,
      1,
    );
    assert.equal(
      (
        await db.query(`select public.trash_leads($1,$2,$3) as n`, [
          orgA,
          [id],
          userA,
        ])
      ).rows[0].n,
      0,
    );
    const removed = (
      await db.query(`select * from public.leads where id=$1`, [id])
    ).rows[0];
    assert.ok(removed.deleted_at);
    assert.equal(removed.do_not_contact, true);
    assert.equal(
      (
        await db.query(
          `select public.finish_automation_job($1,$2,null) as ok`,
          [job, claimed.lock_token],
        )
      ).rows[0].ok,
      false,
    );
    assert.equal(
      (
        await db.query(
          `select cardinality(selected_lead_ids) as n from public.autopilot_settings where organization_id=$1`,
          [orgA],
        )
      ).rows[0].n,
      0,
    );
    assert.equal(
      (
        await db.query(`select public.restore_leads($1,$2,$3) as n`, [
          orgA,
          [id],
          userA,
        ])
      ).rows[0].n,
      1,
    );
    const restored = (
      await db.query(`select * from public.leads where id=$1`, [id])
    ).rows[0];
    assert.equal(restored.deleted_at, null);
    assert.equal(restored.status, "NEW");
    assert.equal(restored.do_not_contact, false);
    assert.equal(
      (
        await db.query(
          `select status from public.automation_jobs where id=$1`,
          [job],
        )
      ).rows[0].status,
      "cancelled",
    );
    assert.equal(
      (
        await db.query(
          `select has_function_privilege('authenticated','public.trash_leads(uuid,uuid[],uuid)','execute') as allowed`,
        )
      ).rows[0].allowed,
      false,
    );
    await db.exec("savepoint access_check");
    await assert.rejects(
      db.query(`select public.trash_leads($1,$2,$3)`, [orgA, [leadB], userA]),
      /Inaccessible lead/,
    );
    await db.exec("rollback to access_check");
    await assert.rejects(
      db.query(`select public.trash_leads($1,$2,$3)`, [orgA, [id], viewer]),
      /Administrator required/,
    );
  } finally {
    await db.exec("rollback");
  }
});

test("Gmail credentials and dispatch functions are inaccessible even to tenant administrators", async () => {
  for (const user of [userA, userB, viewer, outsider]) {
    for (const table of [
      "gmail_accounts",
      "gmail_delivery_attempts",
      "gmail_threads",
      "gmail_autopilot_settings",
    ])
      await asUser(user, async () =>
        assert.rejects(
          () => db.query(`select * from public.${table}`),
          /permission denied/,
        ),
      );
    await asUser(user, async () =>
      assert.rejects(
        () =>
          db.query("select public.claim_gmail_delivery($1,$2,$3)", [
            orgA,
            leadA,
            "forged",
          ]),
        /permission denied/,
      ),
    );
    await asUser(user, async () =>
      assert.rejects(
        () => db.query("select public.schedule_gmail_autopilot($1)", [orgB]),
        /permission denied/,
      ),
    );
  }
});

test("Gmail serializes dispatch, preserves ambiguous reservations, applies mailbox caps and resets next day", async () => {
  await db.exec("begin");
  try {
    const account = (
      await db.query(
        "insert into public.gmail_accounts(organization_id,email,google_subject,encrypted_refresh_token,daily_cap) values($1,'sender@gmail.com','test-subject','encrypted-test',2) returning id",
        [orgA],
      )
    ).rows[0].id;
    const claim = async (key) =>
      (
        await db.query("select public.claim_gmail_delivery($1,$2,$3) claimed", [
          orgA,
          account,
          key,
        ])
      ).rows[0].claimed;
    assert.equal(await claim("request-1"), true);
    assert.equal(await claim("request-1"), false);
    await db.exec("savepoint expected_error");
    await assert.rejects(() => claim("request-2"), /GMAIL_DEFERRED/);
    await db.exec("rollback to savepoint expected_error");
    await db.query(
      "update public.gmail_accounts set next_send_at=null where id=$1",
      [account],
    );
    assert.equal(await claim("request-2"), true);
    await db.query(
      "update public.gmail_accounts set next_send_at=null where id=$1",
      [account],
    );
    await db.exec("savepoint expected_error");
    await assert.rejects(() => claim("request-3"), /GMAIL_DEFERRED/);
    await db.exec("rollback to savepoint expected_error");
    await db.query(
      "update public.gmail_delivery_attempts set status='unknown' where delivery_key='request-1'",
    );
    assert.equal(await claim("request-1"), false);
    await db.query(
      "update public.gmail_delivery_attempts set created_at=now()-interval '1 day' where account_id=$1",
      [account],
    );
    assert.equal(await claim("request-3"), true);
    await assert.rejects(
      () =>
        db.query("select public.claim_gmail_delivery($1,$2,$3)", [
          orgB,
          account,
          "other-org",
        ]),
      /reconectare/,
    );
  } finally {
    await db.exec("rollback");
  }
});

test("Gmail rechecks opt-outs, replies, stopped membership, approval and sync before committing a delivery attempt", async () => {
  await db.exec("begin");
  try {
    await db.query("select set_config('request.jwt.claim.sub',$1,true)", [
      userA,
    ]);
    const campaign = (
      await db.query(
        "insert into public.campaigns(organization_id,name,sender_identity,mode,status,window_start,window_end,weekdays_only) values($1,'Gmail dispatch fixture','recheck@gmail.com','automatic','active','00:00','23:59:59',false) returning id",
        [orgA],
      )
    ).rows[0].id;
    const account = (
      await db.query(
        "insert into public.gmail_accounts(organization_id,email,google_subject,encrypted_refresh_token,last_test_at,last_synced_at,campaign_id) values($1,'recheck@gmail.com','dispatch-subject','encrypted',now(),now(),$2) returning id",
        [orgA, campaign],
      )
    ).rows[0].id;
    await db.query(
      "insert into public.gmail_autopilot_settings(organization_id,enabled) values($1,true)",
      [orgA],
    );
    const lead = (
      await db.query(
        "insert into public.leads(organization_id,company_name,email,status) values($1,'Dispatch Clinic','dispatch@fixture.example.ro','READY_FOR_OUTREACH') returning id",
        [orgA],
      )
    ).rows[0].id;
    await db.query(
      "insert into public.campaign_leads(organization_id,campaign_id,lead_id) values($1,$2,$3)",
      [orgA, campaign, lead],
    );
    const message = (
      await db.query(
        "insert into public.messages(organization_id,lead_id,campaign_id,direction,status,body,idempotency_key,follow_up_number) values($1,$2,$3,'outbound','sending','Fixture','dispatch-recheck',0) returning id",
        [orgA, lead, campaign],
      )
    ).rows[0].id;
    const claim = () =>
      db.query("select public.claim_gmail_delivery($1,$2,$3) claimed", [
        orgA,
        account,
        message,
      ]);
    for (const [sql, args, reason] of [
      [
        "update public.leads set do_not_contact=true where id=$1",
        [lead],
        /GMAIL_STOPPED/,
      ],
      [
        "update public.leads set status='HUMAN_REQUIRED' where id=$1",
        [lead],
        /GMAIL_STOPPED/,
      ],
      [
        "insert into public.suppression_list(organization_id,identifier,channel,reason) values($1,'dispatch@fixture.example.ro','email','fixture')",
        [orgA],
        /GMAIL_STOPPED/,
      ],
      [
        "insert into public.messages(organization_id,lead_id,direction,status,body,idempotency_key) values($1,$2,'inbound','received','Already replied','dispatch-inbound')",
        [orgA, lead],
        /GMAIL_STOPPED/,
      ],
      [
        "update public.campaign_leads set stopped_at=now() where lead_id=$1",
        [lead],
        /GMAIL_STOPPED/,
      ],
      [
        "update public.messages set status='cancelled' where id=$1",
        [message],
        /GMAIL_STOPPED/,
      ],
      [
        "update public.campaigns set status='paused' where id=$1",
        [campaign],
        /GMAIL_DEFERRED/,
      ],
      [
        "update public.gmail_autopilot_settings set enabled=false where organization_id=$1",
        [orgA],
        /GMAIL_DEFERRED/,
      ],
      [
        "update public.gmail_accounts set last_synced_at=now()-interval '16 minutes' where id=$1",
        [account],
        /GMAIL_DEFERRED/,
      ],
    ]) {
      await db.exec("savepoint dispatch_case");
      await db.query(sql, args);
      await assert.rejects(claim, reason);
      await db.exec("rollback to dispatch_case");
      assert.equal(
        (
          await db.query(
            "select count(*)::int n from public.gmail_delivery_attempts where account_id=$1",
            [account],
          )
        ).rows[0].n,
        0,
      );
    }
    // A reviewer-approved reply remains valid even though receiving a reply
    // stopped the campaign membership and set the lead to human attention.
    await db.query(
      "update public.leads set status='HUMAN_REQUIRED' where id=$1",
      [lead],
    );
    await db.query(
      "update public.campaign_leads set stopped_at=now() where lead_id=$1",
      [lead],
    );
    await db.query(
      "update public.messages set follow_up_number=null,metadata='{\"human_approved\":true}' where id=$1",
      [message],
    );
    assert.equal((await claim()).rows[0].claimed, true);
    assert.equal((await claim()).rows[0].claimed, false);
  } finally {
    await db.exec("rollback");
  }
});

test("Gmail Autopilot distributes prospects once, excludes test/suppressed leads, waits at capacity and resumes next day", async () => {
  await db.exec("begin");
  try {
    await db.query("select set_config('request.jwt.claim.sub',$1,true)", [
      userA,
    ]);
    const campaign = (
      await db.query(
        "insert into public.campaigns(organization_id,name,sender_identity,mode,status,daily_cap,max_follow_ups) values($1,'Gmail Autopilot test','pilot@gmail.com','automatic','active',2,0) returning id",
        [orgA],
      )
    ).rows[0].id;
    const account = (
      await db.query(
        "insert into public.gmail_accounts(organization_id,email,google_subject,encrypted_refresh_token,daily_cap,campaign_id) values($1,'pilot@gmail.com','pilot-subject','encrypted-test',2,$2) returning id",
        [orgA, campaign],
      )
    ).rows[0].id;
    await db.query(
      "insert into public.gmail_autopilot_settings(organization_id,enabled) values($1,true)",
      [orgA],
    );
    await db.query(
      "update public.leads set do_not_contact=true where organization_id=$1",
      [orgA],
    );
    const ids = [];
    for (let i = 0; i < 6; i++)
      ids.push(
        (
          await db.query(
            "insert into public.leads(organization_id,company_name,email,source) values($1,$2,$3,$4) returning id",
            [
              orgA,
              `Gmail fixture ${i}`,
              `gmail-fixture-${i}@fixture.example.ro`,
              i === 4 ? "ai-controlled-test" : "manual",
            ],
          )
        ).rows[0].id,
      );
    await db.query(
      "insert into public.suppression_list(organization_id,lead_id,channel,identifier,reason) values($1,$2,'all','gmail-fixture-5@fixture.example.ro','fixture suppression')",
      [orgA, ids[5]],
    );
    const list = (
      await db.query(
        "insert into public.lead_lists(organization_id,name) values($1,'Dental fixture') returning id",
        [orgA],
      )
    ).rows[0].id;
    await db.query(
      "update public.gmail_autopilot_settings set enabled=false where organization_id=$1",
      [orgA],
    );
    await db.query("update public.leads set lead_list_id=$2 where id=any($1)", [
      ids,
      list,
    ]);
    await db.query(
      "update public.gmail_autopilot_settings set lead_list_id=$2,enabled=true where organization_id=$1",
      [orgA, list],
    );
    const assign = async () =>
      (
        await db.query("select public.schedule_gmail_autopilot($1) assigned", [
          orgA,
        ])
      ).rows[0].assigned;
    assert.equal(await assign(), 2);
    assert.equal(await assign(), 0);
    const members = (
      await db.query(
        "select lead_id from public.campaign_leads where campaign_id=$1",
        [campaign],
      )
    ).rows;
    assert.ok(members.every((row) => ids.slice(0, 4).includes(row.lead_id)));
    for (let i = 0; i < members.length; i++) {
      await db.query(
        "insert into public.messages(organization_id,campaign_id,lead_id,direction,status,body,idempotency_key,follow_up_number) values($1,$2,$3,'outbound','sent','fixture',$4,0)",
        [orgA, campaign, members[i].lead_id, `gmail-sent-${i}`],
      );
      await db.query(
        "insert into public.gmail_delivery_attempts(organization_id,account_id,delivery_key,status) values($1,$2,$3,'sent')",
        [orgA, account, `gmail-attempt-${i}`],
      );
    }
    assert.equal(await assign(), 0);
    await db.query(
      "update public.gmail_delivery_attempts set created_at=now()-interval '1 day' where account_id=$1",
      [account],
    );
    assert.equal(await assign(), 2);
    await db.query(
      "update public.gmail_autopilot_settings set enabled=false where organization_id=$1",
      [orgA],
    );
    assert.equal(await assign(), 0);
    assert.equal(
      (await db.query("select public.schedule_gmail_autopilot($1) n", [orgB]))
        .rows[0].n,
      0,
    );
  } finally {
    await db.exec("rollback");
  }
});

test("Gmail Start and Pause are atomic, preserve one campaign per mailbox and require a tested mailbox", async () => {
  await db.exec("begin");
  try {
    await db.query("select set_config('request.jwt.claim.sub',$1,true)", [
      userA,
    ]);
    const account = (
      await db.query(
        "insert into public.gmail_accounts(organization_id,email,google_subject,encrypted_refresh_token) values($1,'atomic@gmail.com','atomic-subject','encrypted-test') returning id",
        [orgA],
      )
    ).rows[0].id;
    const call = async (run) =>
      (
        await db.query(
          "select public.set_gmail_autopilot($1,$2,'Approved test template') n",
          [orgA, run],
        )
      ).rows[0].n;
    await db.exec("savepoint untested");
    await assert.rejects(() => call(true), /internal test/);
    await db.exec("rollback to savepoint untested");
    assert.equal(
      (
        await db.query(
          "select count(*)::int n from public.gmail_autopilot_settings where organization_id=$1",
          [orgA],
        )
      ).rows[0].n,
      0,
    );
    await db.query(
      "update public.gmail_accounts set last_test_at=now() where id=$1",
      [account],
    );
    await db.exec("set local role authenticated");
    assert.equal(await call(true), 1);
    await db.exec("reset role");
    const first = (
      await db.query(
        "select campaign_id from public.gmail_accounts where id=$1",
        [account],
      )
    ).rows[0].campaign_id;
    assert.equal(await call(true), 1);
    // Restarting Autopilot must retain the daily policy used by reservation
    // and the final Gmail delivery recheck, including local timezone handling.
    const schedule = (
      await db.query(
        "select window_start::text,window_end::text,weekdays_only,daily_cap from public.campaigns where id=$1",
        [first],
      )
    ).rows[0];
    assert.deepEqual(schedule, {
      window_start: "08:00:00",
      window_end: "18:00:00",
      weekdays_only: true,
      daily_cap: 10,
    });
    for (const [instant, expected] of [
      ["2026-10-19T04:59:59Z", false],
      ["2026-10-19T05:00:00Z", true],
      ["2026-10-19T08:59:59Z", true],
      ["2026-10-19T09:00:00Z", true],
      ["2026-10-19T14:59:59Z", true],
      ["2026-10-19T15:00:00Z", false],
      ["2026-10-24T08:00:00Z", false],
      ["2026-10-25T08:00:00Z", false],
      ["2026-10-26T05:59:59Z", false],
      ["2026-10-26T06:00:00Z", true],
    ]) {
      const result = await db.query(
        `select not ((c.weekdays_only and extract(isodow from t.local_now)>5)
        or t.local_now::time<c.window_start or t.local_now::time>=c.window_end) allowed
        from public.campaigns c cross join (select $2::timestamptz at time zone 'Europe/Bucharest' local_now) t
        where c.id=$1`,
        [first, instant],
      );
      assert.equal(result.rows[0].allowed, expected, instant);
    }
    assert.equal(
      (
        await db.query(
          "select campaign_id from public.gmail_accounts where id=$1",
          [account],
        )
      ).rows[0].campaign_id,
      first,
    );
    assert.equal(
      (
        await db.query(
          "select count(*)::int n from public.campaigns where organization_id=$1 and name='Autopilot · atomic@gmail.com'",
          [orgA],
        )
      ).rows[0].n,
      1,
    );
    assert.equal(await call(false), 0);
    assert.equal(
      (
        await db.query(
          "select enabled from public.gmail_autopilot_settings where organization_id=$1",
          [orgA],
        )
      ).rows[0].enabled,
      false,
    );
    assert.equal(
      (
        await db.query("select status from public.campaigns where id=$1", [
          first,
        ])
      ).rows[0].status,
      "paused",
    );
  } finally {
    await db.exec("rollback");
  }
  for (const [user, org] of [
    [viewer, orgA],
    [userB, orgB],
    [outsider, orgA],
    [userA, orgB],
  ])
    await asUser(user, async () =>
      assert.rejects(
        () => db.query("select public.set_gmail_autopilot($1,false,'')", [org]),
        /Administrator necessary/,
      ),
    );
});

test("Gmail accepts a real-source CSV lead with unsent drafts, preserves history and queues exactly one new draft", async () => {
  await db.exec("begin");
  try {
    await db.query("select set_config('request.jwt.claim.sub',$1,true)", [
      userA,
    ]);
    await db.query(
      "update public.leads set do_not_contact=true where organization_id=$1",
      [orgA],
    );
    const old = (
      await db.query(
        "insert into public.campaigns(organization_id,name,status) values($1,'Old review campaign','draft') returning id",
        [orgA],
      )
    ).rows[0].id;
    const lead = (
      await db.query(
        "insert into public.leads(organization_id,company_name,email,source,status) values($1,'CSV fixture clinic','csv-fixture@fixture.example.ro','CSV','READY_FOR_OUTREACH') returning id",
        [orgA],
      )
    ).rows[0].id;
    await db.query(
      "insert into public.campaign_leads(organization_id,campaign_id,lead_id) values($1,$2,$3)",
      [orgA, old, lead],
    );
    const message = (
      await db.query(
        "insert into public.messages(organization_id,campaign_id,lead_id,direction,status,body,idempotency_key,follow_up_number) values($1,$2,$3,'outbound','draft','Keep this draft','old-review-fixture',0) returning id",
        [orgA, old, lead],
      )
    ).rows[0].id;
    const account = (
      await db.query(
        "insert into public.gmail_accounts(organization_id,email,google_subject,encrypted_refresh_token,daily_cap,last_test_at) values($1,'csv@gmail.com','csv-subject','encrypted-test',1,now()) returning id",
        [orgA],
      )
    ).rows[0].id;
    const list = (
      await db.query(
        "insert into public.lead_lists(organization_id,name) values($1,'CSV pool') returning id",
        [orgA],
      )
    ).rows[0].id;
    await db.query("update public.leads set lead_list_id=$2 where id=$1", [
      lead,
      list,
    ]);
    await db.query("select public.select_gmail_lead_list($1,$2)", [orgA, list]);
    await db.query(
      "select public.set_gmail_autopilot($1,true,'Approved template')",
      [orgA],
    );
    assert.equal(
      (await db.query("select public.schedule_gmail_autopilot($1) n", [orgA]))
        .rows[0].n,
      1,
    );
    assert.equal(
      (await db.query("select public.schedule_gmail_autopilot($1) n", [orgA]))
        .rows[0].n,
      0,
    );
    assert.equal(
      (
        await db.query("select status,body from public.messages where id=$1", [
          message,
        ])
      ).rows[0].status,
      "cancelled",
    );
    assert.equal(
      (
        await db.query("select body from public.messages where id=$1", [
          message,
        ])
      ).rows[0].body,
      "Keep this draft",
    );
    const campaign = (
      await db.query(
        "select campaign_id from public.gmail_accounts where id=$1",
        [account],
      )
    ).rows[0].campaign_id;
    assert.equal(
      (
        await db.query(
          "select count(*)::int n from public.automation_jobs where organization_id=$1 and lead_id=$2 and kind='create_outreach_drafts' and payload->>'campaign_id'=$3",
          [orgA, lead, campaign],
        )
      ).rows[0].n,
      1,
    );
    assert.ok(
      (
        await db.query(
          "select stopped_at from public.campaign_leads where campaign_id=$1 and lead_id=$2",
          [old, lead],
        )
      ).rows[0].stopped_at,
    );
  } finally {
    await db.exec("rollback");
  }
});

test("niche campaigns scope 2,000-lead pools, block live switches and isolate tenants", async () => {
  await db.exec("begin");
  try {
    await db.query("select set_config('request.jwt.claim.sub',$1,true)", [
      userA,
    ]);
    const dental = (
      await db.query(
        "insert into public.lead_lists(organization_id,name) values($1,'Dental 2k') returning id",
        [orgA],
      )
    ).rows[0].id;
    const kineto = (
      await db.query(
        "insert into public.lead_lists(organization_id,name) values($1,'Kineto 2k') returning id",
        [orgA],
      )
    ).rows[0].id;
    const foreign = (
      await db.query(
        "insert into public.lead_lists(organization_id,name) values($1,'Other tenant') returning id",
        [orgB],
      )
    ).rows[0].id;
    await db.query(
      "insert into public.leads(organization_id,lead_list_id,company_name,email,source) select $1,$2,'Dental '||i,'dental'||i||'@fixture.example.ro','Excel' from generate_series(1,2000) i",
      [orgA, dental],
    );
    await db.query(
      "insert into public.leads(organization_id,lead_list_id,company_name,email,source) select $1,$2,'Kineto '||i,'kineto'||i||'@fixture.example.ro','Excel' from generate_series(1,2000) i",
      [orgA, kineto],
    );
    await db.query(
      "insert into public.gmail_accounts(organization_id,email,google_subject,encrypted_refresh_token,daily_cap,last_test_at) values($1,'list-pilot@gmail.com','list-pilot','test',7,now())",
      [orgA],
    );
    await db.query(
      "select public.start_gmail_lead_list($1,$2,'Approved template')",
      [orgA, dental],
    );
    assert.equal(
      (await db.query("select public.schedule_gmail_autopilot($1) n", [orgA]))
        .rows[0].n,
      7,
    );
    assert.equal(
      (
        await db.query(
          "select count(*)::int n from public.campaign_leads cl join public.leads l on l.id=cl.lead_id where l.lead_list_id=$1",
          [kineto],
        )
      ).rows[0].n,
      0,
    );
    await db.exec("savepoint live_switch");
    await assert.rejects(
      () =>
        db.query("select public.select_gmail_lead_list($1,$2)", [orgA, kineto]),
      /Pause/,
    );
    await db.exec("rollback to live_switch");
    await db.query("select public.set_gmail_autopilot($1,false,'')", [orgA]);
    await db.exec("savepoint tenant");
    await assert.rejects(
      () =>
        db.query("select public.select_gmail_lead_list($1,$2)", [
          orgA,
          foreign,
        ]),
      /unavailable/,
    );
    await db.exec("rollback to tenant");
    await db.query(
      "select public.start_gmail_lead_list($1,$2,'Approved template')",
      [orgA, kineto],
    );
    assert.equal(
      (await db.query("select public.schedule_gmail_autopilot($1) n", [orgA]))
        .rows[0].n,
      7,
    );
    assert.equal(
      (
        await db.query(
          "select count(*)::int n from public.campaign_leads cl join public.leads l on l.id=cl.lead_id where l.lead_list_id=$1 and cl.stopped_at is null",
          [dental],
        )
      ).rows[0].n,
      0,
    );
    await db.exec("savepoint moving");
    await assert.rejects(
      () =>
        db.query(
          "update public.leads set lead_list_id=$2 where organization_id=$1 and lead_list_id=$3",
          [orgA, dental, kineto],
        ),
      /Pause/,
    );
    await db.exec("rollback to moving");
    await db.exec("set local role authenticated");
    assert.equal(
      (await db.query("select * from public.lead_lists where id=$1", [foreign]))
        .rows.length,
      0,
    );
    await db.exec("reset role");
  } finally {
    await db.exec("rollback");
  }
});

test("new Gmail mailboxes default to ten daily sends", async () => {
  await db.exec("begin");
  try {
    const account = (
      await db.query(
        "insert into public.gmail_accounts(organization_id,email,google_subject,encrypted_refresh_token) values($1,'default-ten@gmail.com','default-ten','encrypted-fixture') returning daily_cap",
        [orgA],
      )
    ).rows[0];
    assert.equal(account.daily_cap, 10);
  } finally {
    await db.exec("rollback");
  }
});
