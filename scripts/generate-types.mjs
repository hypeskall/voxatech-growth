import { writeFile } from "node:fs/promises";
// Called explicitly with the migrated local PostgreSQL database. No credential access.
export async function generateTypes(db) {
  const rows = (
    await db.query(
      `select table_name,column_name,is_nullable,column_default,data_type,udt_name,is_generated from information_schema.columns where table_schema='public' order by table_name,ordinal_position`,
    )
  ).rows;
  const enumRows = (
    await db.query(
      `select t.typname,e.enumlabel from pg_type t join pg_enum e on e.enumtypid=t.oid join pg_namespace n on n.oid=t.typnamespace where n.nspname='public' order by t.typname,e.enumsortorder`,
    )
  ).rows;
  const enums = {};
  for (const row of enumRows) (enums[row.typname] ||= []).push(row.enumlabel);
  const grouped = {};
  for (const row of rows) (grouped[row.table_name] ||= []).push(row);
  function type(row) {
    let value =
      row.udt_name === "jsonb"
        ? "Json"
        : row.data_type === "ARRAY"
          ? "string[]"
          : ["int2", "int4", "int8", "numeric", "float4", "float8"].includes(
                row.udt_name,
              )
            ? "number"
            : row.udt_name === "bool"
              ? "boolean"
              : enums[row.udt_name]
                ? `Database['public']['Enums']['${row.udt_name}']`
                : "string";
    if (row.is_nullable === "YES") value += " | null";
    return value;
  }
  let output =
    "// Generated from the validated SQL migrations. Regenerate after schema changes.\nexport type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];\nexport type Database = { public: { Tables: {\n";
  for (const [table, columns] of Object.entries(grouped)) {
    output += `  ${table}: {\n    Row: {\n${columns.map((c) => `      ${c.column_name}: ${type(c)};`).join("\n")}\n    };\n`;
    output += `    Insert: {\n${columns.map((c) => `      ${c.column_name}${c.column_default || c.is_nullable === "YES" || c.is_generated === "ALWAYS" ? "?" : ""}: ${c.is_generated === "ALWAYS" ? "never" : type(c)};`).join("\n")}\n    };\n`;
    output += `    Update: {\n${columns.map((c) => `      ${c.column_name}?: ${c.is_generated === "ALWAYS" ? "never" : type(c)};`).join("\n")}\n    };\n    Relationships: [];\n  };\n`;
  }
  output += `}; Views: Record<string, never>; Functions: { daily_metrics: { Args: {org:string;day?:string}; Returns:Json }; schedule_due_jobs: { Args: {target_org?:string;delivery_mode?:string}; Returns:undefined }; claim_organization_job: { Args: {target_org?:string}; Returns: Database['public']['Tables']['automation_jobs']['Row'][] }; defer_automation_job: { Args: {job_id:string;token:string}; Returns:boolean }; reserve_outbound_message: { Args: { message_id: string }; Returns: Database['public']['Tables']['messages']['Row'][] }; simulate_outbound_message: { Args: { message_id: string }; Returns: Database['public']['Tables']['messages']['Row'][] }; assign_leads_to_campaign: { Args: {org:string;target_campaign:string;target_leads:string[]}; Returns:number }; suppress_lead: { Args: { org: string; target: string; reason_text: string }; Returns: undefined }; apply_payment: { Args: {org:string;target:string;reference:string;amount:number;currency_code:string}; Returns:string }; claim_automation_jobs: { Args: { batch_size?: number }; Returns: Database['public']['Tables']['automation_jobs']['Row'][] }; finish_automation_job: { Args: { job_id: string; token: string; failure?: string | null }; Returns: boolean } }; Enums: {\n`;
  output += Object.entries(enums)
    .map(
      ([key, values]) => `  ${key}: ${values.map(JSON.stringify).join(" | ")};`,
    )
    .join("\n");
  output += "\n}; CompositeTypes: Record<string, never> } };\n";
  await writeFile(
    new URL("../src/lib/supabase/database.types.ts", import.meta.url),
    output,
  );
}
