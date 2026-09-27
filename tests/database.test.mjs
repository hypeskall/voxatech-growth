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
  assert.equal(rows.length, 21);
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
      2,
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
