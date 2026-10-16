import { createClient } from "@supabase/supabase-js";
import { createHash } from "node:crypto";
import { z } from "zod";
import { management } from "./shared.mjs";
import { openGmailSecret } from "../src/lib/gmail-security.ts";

// Read-only diagnostics: never invokes a worker, changes settings or sends mail.
const local = process.argv.includes("--local");
const checks = [];
function report(label, ok, next = "") {
  checks.push({ label, ok: !!ok, next: ok ? "" : next });
}
report(
  "Client Google",
  process.env.GOOGLE_GMAIL_CLIENT_ID?.endsWith(".apps.googleusercontent.com") &&
    process.env.GOOGLE_GMAIL_CLIENT_SECRET,
  "Configurează clientul OAuth Web din Google Cloud.",
);
report(
  "Cheie de criptare Gmail",
  /^[a-f0-9]{64}$/i.test(process.env.GMAIL_TOKEN_ENCRYPTION_KEY || ""),
  "Rulează configurarea Gmail și păstrează cheia originală.",
);
report(
  "Adresă proprie pentru teste",
  z.email().safeParse(process.env.INTERNAL_TEST_EMAIL).success,
  "Setează INTERNAL_TEST_EMAIL cu o adresă proprie care nu apare în leaduri.",
);
report(
  "Asistent AI",
  process.env.GEMINI_API_KEY,
  "Configurează GEMINI_API_KEY pe server.",
);
report(
  "Secret programare",
  (process.env.AUTOPILOT_CRON_SECRET?.length || 0) >= 32,
  "Restaurează secretul existent; nu genera un secret diferit de cel din Supabase Vault.",
);
report(
  "Livrare reală",
  process.env.EMAIL_DELIVERY_MODE === "live",
  "După testele interne, setează EMAIL_DELIVERY_MODE=live pe server și redeployează.",
);
try {
  const client = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
  const { data, error } = await client
    .from("gmail_accounts")
    .select(
      "organization_id,google_subject,status,last_test_at,encrypted_refresh_token",
    );
  if (error) throw new Error("Database unavailable");
  report("Baza de date Gmail", true);
  const connected = data.filter((account) => account.status === "connected");
  report(
    "Cel puțin o căsuță conectată",
    connected.length > 0,
    "Conectează conturile din Setări → Integrări.",
  );
  report(
    "Test din fiecare căsuță conectată",
    connected.length > 0 && connected.every((account) => account.last_test_at),
    "Trimite și verifică un test intern din fiecare cont.",
  );
  let readable = true;
  for (const account of data.filter(
    (account) => account.encrypted_refresh_token,
  )) {
    try {
      openGmailSecret(
        account.encrypted_refresh_token,
        `${account.organization_id}:${account.google_subject}`,
      );
    } catch {
      readable = false;
    }
  }
  report(
    "Cheia poate citi conexiunile salvate",
    readable,
    "Restaurează cheia de criptare folosită la conectarea conturilor; nu o înlocui.",
  );
  if (process.env.INTERNAL_TEST_EMAIL) {
    const test = await client
      .from("leads")
      .select("id", { count: "exact", head: true })
      .eq(
        "normalized_email",
        process.env.INTERNAL_TEST_EMAIL.trim().toLowerCase(),
      );
    report(
      "Adresa de test este separată de leaduri",
      !test.error && test.count === 0,
      "Alege o adresă proprie care nu se află în lista de prospecte.",
    );
  }
} catch {
  report(
    "Baza de date Gmail",
    false,
    "Verifică accesul Supabase și aplicarea migrărilor.",
  );
}
if (process.env.SUPABASE_ACCESS_TOKEN) {
  try {
    const rows = await management("/database/query", "POST", {
      query: `select (select count(*) from cron.job where jobname='voxa-growth-autopilot' and active and schedule='*/5 * * * *')::int schedules, (select encode(sha256(convert_to(decrypted_secret,'UTF8')),'hex') from vault.decrypted_secrets where name='voxa_growth_autopilot_secret') secret_hash`,
    });
    report(
      "Programare la fiecare 5 minute",
      rows[0]?.schedules === 1,
      "Rulează scriptul configure-gmail-scheduler.mjs.",
    );
    const hash = createHash("sha256")
      .update(process.env.AUTOPILOT_CRON_SECRET || "")
      .digest("hex");
    report(
      "Secretul local corespunde programării",
      hash === rows[0]?.secret_hash,
      "Restaurează același AUTOPILOT_CRON_SECRET în configurația locală și în Vercel.",
    );
  } catch {
    report(
      "Programare verificată",
      false,
      "Verifică accesul de administrare Supabase. Nu a fost modificată programarea.",
    );
  }
} else
  report(
    "Programare verificată",
    false,
    "Verificarea necesită SUPABASE_ACCESS_TOKEN local, care nu se publică în Vercel.",
  );
try {
  const origin = local
    ? "http://localhost:3014"
    : "https://voxa-growth.vercel.app";
  const response = await fetch(`${origin}/api/gmail/connect`, {
    redirect: "manual",
    signal: AbortSignal.timeout(15000),
  });
  report(
    local ? "Versiunea Gmail disponibilă local" : "Versiunea Gmail publicată",
    response.status === 405,
    "Publică versiunea actualizată în proiectul Vercel existent; local, pornește aplicația pe portul 3014.",
  );
} catch {
  report(
    "Aplicația accesibilă",
    false,
    "Verifică site-ul sau pornește aplicația locală.",
  );
}
for (const check of checks)
  console.log(
    `${check.ok ? "OK" : "DE FĂCUT"} — ${check.label}${check.next ? `: ${check.next}` : ""}`,
  );
console.log(
  "Verificarea este doar de citire. Activarea finală se face din butonul Pornește Autopilot.",
);
if (checks.some((check) => !check.ok)) process.exitCode = 1;
