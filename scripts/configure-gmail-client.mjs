import { readFile, writeFile, rename } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import { z } from "zod";

const file = process.argv[2];
const localOnly = process.argv.includes("--local-only");
if (!file)
  throw new Error(
    "Usage: node --env-file=.env.local scripts/configure-gmail-client.mjs .secrets/google-client.json",
  );
const client = z
  .object({
    web: z.object({
      client_id: z.string().endsWith(".apps.googleusercontent.com"),
      client_secret: z.string().min(1),
      redirect_uris: z.array(z.string()),
    }),
  })
  .parse(JSON.parse(await readFile(file, "utf8"))).web;
const callback = "https://voxa-growth.vercel.app/api/gmail/callback";
if (!client.redirect_uris.includes(callback))
  throw new Error(`Register the callback in Google Cloud first: ${callback}`);
if (!z.email().safeParse(process.env.INTERNAL_TEST_EMAIL).success)
  throw new Error(
    "Set INTERNAL_TEST_EMAIL in .env.local to your own test mailbox first.",
  );
const originalKey = process.env.GMAIL_TOKEN_ENCRYPTION_KEY;
const fields = {
  GOOGLE_GMAIL_CLIENT_ID: client.client_id,
  GOOGLE_GMAIL_CLIENT_SECRET: client.client_secret,
  GMAIL_TOKEN_ENCRYPTION_KEY: originalKey || randomBytes(32).toString("hex"),
  INTERNAL_TEST_EMAIL: process.env.INTERNAL_TEST_EMAIL,
};
if (!/^[a-f0-9]{64}$/i.test(fields.GMAIL_TOKEN_ENCRYPTION_KEY))
  throw new Error("Invalid existing Gmail encryption key");
let dotenv = await readFile(new URL("../.env.local", import.meta.url), "utf8");
for (const [key, value] of Object.entries(fields)) {
  const pattern = new RegExp(`^${key}=.*$`, "m");
  const line = `${key}=${JSON.stringify(value)}`;
  dotenv = pattern.test(dotenv)
    ? dotenv.replace(pattern, () => line)
    : `${dotenv.trimEnd()}\n${line}\n`;
}
const link = JSON.parse(
  await readFile(new URL("../.vercel/project.json", import.meta.url), "utf8"),
);
if (
  link.projectName !== "voxa-growth" ||
  link.projectId !== "prj_hNHB00Tsq2XqZ67nIFNTfamhHcrL"
)
  throw new Error("Refusing another Vercel project");
async function saveLocal() {
  const target = new URL("../.env.local", import.meta.url);
  const temporary = new URL(
    `../.env.local.${randomBytes(8).toString("hex")}.tmp`,
    import.meta.url,
  );
  await writeFile(temporary, dotenv, { flag: "wx" });
  await rename(temporary, target);
}
if (localOnly) {
  await saveLocal();
  console.log(
    "Configurarea Gmail a fost salvată doar local. Repornește aplicația. Vercel și modul de livrare nu au fost schimbate. Păstrează această cheie pentru configurarea ulterioară a serverului.",
  );
  process.exit(0);
}
const auth = JSON.parse(
  await readFile(
    `${process.env.APPDATA}/com.vercel.cli/Data/auth.json`,
    "utf8",
  ),
);
const endpoint = `https://api.vercel.com/v10/projects/${link.projectId}/env?teamId=${link.orgId}`;
const listed = await fetch(endpoint, {
  headers: { Authorization: `Bearer ${auth.token}` },
  signal: AbortSignal.timeout(20000),
});
if (!listed.ok)
  throw new Error(`Vercel configuration read HTTP ${listed.status}`);
const envs = (await listed.json()).envs;
if (
  envs.some(
    (item) =>
      item.key === "GMAIL_TOKEN_ENCRYPTION_KEY" &&
      item.target.includes("production"),
  ) &&
  !originalKey
)
  throw new Error(
    "The deployment already has a Gmail encryption key. Restore the original key in .env.local before configuring this client. No local configuration was overwritten.",
  );
await saveLocal();
for (const [key, value] of Object.entries(fields)) {
  const existing = envs.find(
    (item) => item.key === key && item.target.includes("production"),
  );
  // Never silently replace an existing encryption key; existing OAuth tokens
  // would become unreadable. Use the original local key or rotate deliberately.
  if (key === "GMAIL_TOKEN_ENCRYPTION_KEY" && existing) continue;
  const response = await fetch(
    existing
      ? `https://api.vercel.com/v9/projects/${link.projectId}/env/${existing.id}?teamId=${link.orgId}`
      : endpoint,
    {
      method: existing ? "PATCH" : "POST",
      headers: {
        Authorization: `Bearer ${auth.token}`,
        "Content-Type": "application/json",
      },
      // Sensitive variables reject a PATCH containing `key`, even unchanged.
      // Update only the value and preserve existing storage type and targets.
      body: JSON.stringify(
        existing
          ? { value, target: existing.target }
          : { key, value, type: "sensitive", target: ["production"] },
      ),
      signal: AbortSignal.timeout(20000),
    },
  );
  if (!response.ok)
    throw new Error(`Vercel ${key} update HTTP ${response.status}`);
}
console.log(
  "Google Gmail configuration saved locally and for the Voxa Growth production deployment. Redeploy, connect your mailboxes and run internal tests. Delivery mode was not changed.",
);
