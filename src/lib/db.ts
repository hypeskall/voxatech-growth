import "server-only";
import { createSupabaseAdminClient } from "./supabase/admin";
import type { Database, Json } from "./supabase/database.types";
export const admin = createSupabaseAdminClient;
export function check<T>(result: {
  data: T;
  error: { message: string; code?: string } | null;
}): NonNullable<T> {
  if (result.error)
    throw new Error(
      result.error.code === "23505"
        ? "Înregistrare duplicată. Verifică emailul, telefonul, site-ul și compania."
        : result.error.message,
    );
  return result.data as NonNullable<T>;
}
export async function log(
  org: string,
  action: string,
  lead: string | null = null,
  details: Json = {},
  model: string | null = null,
  actor: string | null = null,
) {
  check(
    await admin().from("activities").insert({
      organization_id: org,
      lead_id: lead,
      action,
      details,
      model,
      actor_id: actor,
    }),
  );
}
export async function enqueue(
  org: string,
  kind: string,
  key: string,
  lead: string | null = null,
  payload: Json = {},
  when = new Date().toISOString(),
) {
  check(
    await admin().from("automation_jobs").upsert(
      {
        organization_id: org,
        kind,
        idempotency_key: key,
        lead_id: lead,
        payload,
        next_action_at: when,
      },
      {
        onConflict: "organization_id,idempotency_key",
        ignoreDuplicates: true,
      },
    ),
  );
}
export type Job = Database["public"]["Tables"]["automation_jobs"]["Row"];
export const appUrl = () => process.env.APP_URL || "http://localhost:3000";
export function safeError(error: unknown) {
  let text = error instanceof Error ? error.message : "Eroare necunoscută";
  for (const name of [
    "SUPABASE_SERVICE_ROLE_KEY",
    "SUPABASE_ACCESS_TOKEN",
    "OPENAI_API_KEY",
    "GEMINI_API_KEY",
    "RESEND_API_KEY",
    "RESEND_FROM_EMAIL",
    "INTERNAL_TEST_EMAIL",
    "RESEND_WEBHOOK_SECRET",
    "ELEVENLABS_API_KEY",
    "STRIPE_SECRET_KEY",
    "STRIPE_WEBHOOK_SECRET",
    "CRON_SECRET",
  ]) {
    const value = process.env[name];
    if (value) text = text.split(value).join("[redactat]");
  }
  return text
    .replace(/\b(?:sk-|re_|sb_secret_)[a-zA-Z0-9_-]+/g, "[redactat]")
    .slice(0, 500);
}
