export function required(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing configuration: ${name}`);
  return value;
}
export function project() {
  const url = new URL(required("NEXT_PUBLIC_SUPABASE_URL"));
  if (
    url.protocol !== "https:" ||
    !/^[a-z0-9]+\.supabase\.co$/.test(url.hostname)
  ) {
    throw new Error("Expected the hosted Supabase project HTTPS URL.");
  }
  return { url: url.origin, ref: url.hostname.split(".")[0] };
}
export async function management(path, method = "GET", body) {
  const response = await fetch(
    `https://api.supabase.com/v1/projects/${project().ref}${path}`,
    {
      method,
      headers: {
        Authorization: `Bearer ${required("SUPABASE_ACCESS_TOKEN")}`,
        "Content-Type": "application/json",
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(60000),
    },
  );
  if (!response.ok)
    throw new Error(
      `Supabase management ${path}: HTTP ${response.status}; no secrets logged.`,
    );
  return response.json();
}
export const tables = [
  "organizations",
  "profiles",
  "organization_members",
  "leads",
  "lead_contacts",
  "campaigns",
  "campaign_leads",
  "messages",
  "conversations",
  "activities",
  "tasks",
  "demos",
  "knowledge_base_documents",
  "knowledge_base_versions",
  "automation_jobs",
  "suppression_list",
  "integrations",
  "settings",
  "onboarding_records",
  "notifications",
  "webhook_events",
];
