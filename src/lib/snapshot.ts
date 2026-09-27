import "server-only";
import { session } from "./session";
import { check } from "./db";
import type { Row } from "./domain";
import type { Database } from "./supabase/database.types";
export type Snapshot = {
  leads: Row<"leads">[];
  campaigns: Row<"campaigns">[];
  campaign_leads: Row<"campaign_leads">[];
  messages: Row<"messages">[];
  activities: Row<"activities">[];
  tasks: Row<"tasks">[];
  demos: Row<"demos">[];
  knowledge_base_documents: Row<"knowledge_base_documents">[];
  knowledge_base_versions: Row<"knowledge_base_versions">[];
  automation_jobs: Row<"automation_jobs">[];
  settings: Row<"settings">[];
  integrations: Row<"integrations">[];
  profiles: Row<"profiles">[];
  onboarding_records: Row<"onboarding_records">[];
  notifications: Row<"notifications">[];
  lead_contacts: Row<"lead_contacts">[];
  suppression_list: Row<"suppression_list">[];
  user: { email: string; id: string; role: string; org: string };
  providers: Record<string, boolean>;
  delivery: string;
};
export async function getSnapshot(
  s: NonNullable<Awaited<ReturnType<typeof session>>>,
): Promise<Snapshot> {
  const names = [
    "leads",
    "campaigns",
    "campaign_leads",
    "messages",
    "activities",
    "tasks",
    "demos",
    "knowledge_base_documents",
    "knowledge_base_versions",
    "automation_jobs",
    "settings",
    "integrations",
    "profiles",
    "onboarding_records",
    "notifications",
    "lead_contacts",
    "suppression_list",
  ] as const;
  async function all<T extends keyof Database["public"]["Tables"]>(
    table: T,
  ): Promise<Row<T>[]> {
    const rows: Row<T>[] = [];
    for (let page = 0; page < 100; page++) {
      let query = s.db.from(table).select("*");
      if (table !== "profiles")
        query = query.filter("organization_id", "eq", s.org);
      const batch = check(
        await query
          .order("created_at", { ascending: false })
          .range(page * 1000, (page + 1) * 1000 - 1),
      ) as unknown as Row<T>[];
      rows.push(...batch);
      if (batch.length < 1000) return rows;
    }
    throw new Error("Volum prea mare. Restrânge perioada de raportare.");
  }
  const entries = await Promise.all(
    names.map(async (name) => [name, await all(name)]),
  );
  return {
    ...Object.fromEntries(entries),
    user: {
      email: s.user.email || "",
      id: s.user.id,
      role: s.role,
      org: s.org,
    },
    providers: {
      supabase: true,
      google_gemini: !!process.env.GEMINI_API_KEY,
      resend: !!(
        process.env.RESEND_API_KEY &&
        process.env.RESEND_FROM_EMAIL &&
        process.env.INTERNAL_TEST_EMAIL
      ),
      elevenlabs: !!(
        process.env.ELEVENLABS_API_KEY &&
        process.env.ELEVENLABS_VOXA_VOICE_ID &&
        process.env.ELEVENLABS_PATIENT_VOICE_ID
      ),
      stripe: !!(process.env.STRIPE_SECRET_KEY && process.env.STRIPE_PRICE_ID),
      whatsapp: false,
    },
    delivery: process.env.EMAIL_DELIVERY_MODE === "live" ? "live" : "log",
  } as Snapshot;
}
