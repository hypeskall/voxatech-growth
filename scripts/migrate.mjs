import { readdir, readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { createHash } from "node:crypto";
import { management, required } from "./shared.mjs";
export async function buildMigrationQuery() {
  const directory = new URL("../supabase/migrations/", import.meta.url);
  const files = (await readdir(directory))
    .filter((f) => /^\d+_[a-z_]+\.sql$/.test(f))
    .sort();
  // A single transaction provides all-or-nothing setup and avoids partially applied schema.
  const checks = [];
  for (const file of files) {
    const sql = await readFile(new URL(file, directory), "utf8");
    if (sql.includes("$voxa_migration$"))
      throw new Error("Reserved delimiter in migration");
    const checksum = createHash("sha256").update(sql).digest("hex");
    checks.push(`do $voxa_migration$
  begin
    if exists(select 1 from private.voxa_migrations where name='${file}' and checksum<>'${checksum}') then
      raise exception 'Applied migration checksum mismatch: ${file}';
    end if;
    if not exists(select 1 from private.voxa_migrations where name='${file}') then
      ${sql}
      insert into private.voxa_migrations(name,checksum) values('${file}','${checksum}');
    end if;
  end $voxa_migration$;`);
  }
  const query = `begin;
select pg_advisory_xact_lock(hashtext('voxa_growth_migrations'));
create schema if not exists private;
create table if not exists private.voxa_migrations(name text primary key,checksum text not null,applied_at timestamptz not null default now());
revoke all on private.voxa_migrations from public,anon,authenticated;
${checks.join("\n")}
notify pgrst, 'reload schema';
commit;`;
  return query;
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  required("SUPABASE_ACCESS_TOKEN");
  await management("/database/query", "POST", {
    query: await buildMigrationQuery(),
  });
  console.log("Verified/applied all migrations transactionally.");
}
