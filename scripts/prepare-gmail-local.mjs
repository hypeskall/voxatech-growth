import { readFile, writeFile, rename } from "node:fs/promises";
import { parseEnv } from "node:util";
import { randomBytes, createHash } from "node:crypto";
import { z } from "zod";
import { createClient } from "@supabase/supabase-js";
import { management } from "./shared.mjs";
const target = new URL("../.env.local", import.meta.url);
let text = await readFile(target, "utf8");
const current = parseEnv(text);
const saved = {};
for (const name of [".env.production.local", ".env.autopilot.local"]) {
  try {
    Object.assign(
      saved,
      parseEnv(await readFile(new URL(`../${name}`, import.meta.url), "utf8")),
    );
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
}
const fields = {};
if (!current.AUTOPILOT_CRON_SECRET && saved.AUTOPILOT_CRON_SECRET) {
  const rows = await management("/database/query", "POST", {
    query:
      "select encode(sha256(convert_to(decrypted_secret,'UTF8')),'hex') secret_hash from vault.decrypted_secrets where name='voxa_growth_autopilot_secret'",
  });
  if (
    saved.AUTOPILOT_CRON_SECRET.length < 32 ||
    createHash("sha256").update(saved.AUTOPILOT_CRON_SECRET).digest("hex") !==
      rows[0]?.secret_hash
  )
    throw new Error(
      "Secretul salvat nu corespunde programării. Configurația locală nu a fost schimbată.",
    );
  fields.AUTOPILOT_CRON_SECRET = saved.AUTOPILOT_CRON_SECRET;
}
if (!current.INTERNAL_TEST_EMAIL && saved.INTERNAL_TEST_EMAIL) {
  const recipient = z
    .email()
    .parse(saved.INTERNAL_TEST_EMAIL.trim().toLowerCase());
  const client = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
  const { count, error } = await client
    .from("leads")
    .select("id", { count: "exact", head: true })
    .eq("normalized_email", recipient);
  if (error || count !== 0)
    throw new Error(
      "Adresa de test salvată nu poate fi validată separat de prospecte. Configurația locală nu a fost schimbată.",
    );
  fields.INTERNAL_TEST_EMAIL = recipient;
}
for (const [key, value] of Object.entries(fields)) {
  const line = `${key}=${JSON.stringify(value)}`;
  const pattern = new RegExp(`^${key}=.*$`, "m");
  text = pattern.test(text)
    ? text.replace(pattern, () => line)
    : `${text.trimEnd()}\n${line}\n`;
}
if (Object.keys(fields).length) {
  const temporary = new URL(
    `../.env.local.${randomBytes(8).toString("hex")}.tmp`,
    import.meta.url,
  );
  await writeFile(temporary, text, { flag: "wx" });
  await rename(temporary, target);
}
console.log(
  JSON.stringify({
    restoredFields: Object.keys(fields),
    existingValuesPreserved: true,
    deliveryModeUnchanged: true,
    noMailboxConnectedOrEmailSent: true,
  }),
);
