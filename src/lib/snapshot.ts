import "server-only";
import { session } from "./session";
import { admin, check } from "./db";
import { gmailConfigurationReady } from "./gmail-security";
import { bucharest } from "./domain";
import type { Row } from "./domain";
import type { Database } from "./supabase/database.types";
export type Snapshot = {
  leads: Row<"leads">[];
  archived_leads: Row<"leads">[];
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
  gmail_accounts: GmailAccountSummary[];
  gmail_autopilot_enabled: boolean;
  gmail_lead_list_id: string | null;
  lead_lists: Row<"lead_lists">[];
  gmail_today: Record<string, number>;
};
export type GmailAccountSummary = Pick<
  Row<"gmail_accounts">,
  | "id"
  | "email"
  | "status"
  | "daily_cap"
  | "campaign_id"
  | "last_verified_at"
  | "last_synced_at"
  | "last_error"
  | "last_test_at"
  | "next_send_at"
>;
export async function getSnapshot(
  s: NonNullable<Awaited<ReturnType<typeof session>>>,
  path = "",
): Promise<Snapshot> {
  const section = path.split("/")[0];
  const scoped: Record<string, string[]> = {
    dashboard: [
      "leads",
      "messages",
      "activities",
      "notifications",
      "lead_lists",
    ],
    autopilot: [
      "leads",
      "messages",
      "campaigns",
      "campaign_leads",
      "settings",
      "notifications",
      "lead_lists",
    ],
    inbox: [
      "leads",
      "messages",
      "campaigns",
      "settings",
      "knowledge_base_documents",
      "notifications",
    ],
    settings: [
      "settings",
      "integrations",
      "profiles",
      "automation_jobs",
      "tasks",
      "notifications",
    ],
  };
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
    "lead_lists",
  ] as const;
  async function all<T extends keyof Database["public"]["Tables"]>(
    table: T,
  ): Promise<Row<T>[]> {
    const rows: Row<T>[] = [];
    for (let page = 0; page < 100; page++) {
      const projection =
        section === "dashboard" && table === "activities"
          ? "id,organization_id,lead_id,action,model,created_at"
          : section === "dashboard" && table === "messages"
            ? "id,organization_id,lead_id,direction,provider,sent_at,status,body,metadata,received_at,created_at"
            : section === "dashboard" && table === "leads"
              ? "id,organization_id,company_name,email,status,source,currency,revenue_won,created_at,deleted_at,lead_list_id"
              : "*";
      let query = s.db.from(table).select(projection);
      if (table !== "profiles")
        query = query.filter("organization_id", "eq", s.org);
      if (table === "activities" && section === "dashboard") {
        return check(
          await query.order("created_at", { ascending: false }).limit(100),
        ) as unknown as Row<T>[];
      }
      if (table === "automation_jobs" && section === "settings") {
        return check(
          await query.order("created_at", { ascending: false }).limit(100),
        ) as unknown as Row<T>[];
      }
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
    names.map(async (name) => [
      name,
      scoped[section] && !scoped[section].includes(name) ? [] : await all(name),
    ]),
  );
  const records = Object.fromEntries(entries);
  // Never add credential tables to `names`, which serializes complete rows.
  const [accountResult, autopilotResult, attemptResult] = await Promise.all([
    admin()
      .from("gmail_accounts")
      .select(
        "id,email,status,daily_cap,campaign_id,last_verified_at,last_synced_at,last_error,last_test_at,next_send_at",
      )
      .eq("organization_id", s.org)
      .order("email"),
    admin()
      .from("gmail_autopilot_settings")
      .select("enabled,lead_list_id")
      .eq("organization_id", s.org)
      .maybeSingle(),
    admin()
      .from("gmail_delivery_attempts")
      .select("account_id,created_at")
      .eq("organization_id", s.org)
      .gte("created_at", new Date(Date.now() - 36 * 3600000).toISOString())
      .limit(1000),
  ]);
  const gmailAccounts = check(accountResult),
    gmailAutopilot = check(autopilotResult),
    attempts = check(attemptResult);
  const day = bucharest().date;
  const gmailToday: Record<string, number> = {};
  for (const attempt of attempts)
    if (bucharest(new Date(attempt.created_at)).date === day)
      gmailToday[attempt.account_id] =
        (gmailToday[attempt.account_id] || 0) + 1;
  const archived = (records.leads as Row<"leads">[]).filter(
    (l) => l.deleted_at,
  );
  const archivedIds = new Set(archived.map((l) => l.id));
  records.leads = (records.leads as Row<"leads">[]).filter(
    (l) => !l.deleted_at,
  );
  for (const name of names) {
    if (name === "leads") continue;
    records[name] = records[name].filter(
      (row: { lead_id?: string | null }) =>
        !row.lead_id || !archivedIds.has(row.lead_id),
    );
  }
  return {
    ...records,
    archived_leads: archived,
    gmail_accounts: gmailAccounts,
    gmail_autopilot_enabled: gmailAutopilot?.enabled || false,
    gmail_lead_list_id: gmailAutopilot?.lead_list_id || null,
    gmail_today: gmailToday,
    user: {
      email: s.user.email || "",
      id: s.user.id,
      role: s.role,
      org: s.org,
    },
    providers: {
      supabase: true,
      gmail: gmailConfigurationReady(),
      gmail_scheduler: (process.env.AUTOPILOT_CRON_SECRET?.length || 0) >= 32,
      google_gemini: !!process.env.GEMINI_API_KEY,
      resend: !!(
        process.env.RESEND_API_KEY &&
        process.env.RESEND_FROM_EMAIL &&
        process.env.INTERNAL_TEST_EMAIL
      ),
      elevenlabs: false,
      stripe: false,
      whatsapp: false,
    },
    delivery: process.env.EMAIL_DELIVERY_MODE === "live" ? "live" : "log",
  } as Snapshot;
}
