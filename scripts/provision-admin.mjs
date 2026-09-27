import { createClient } from "@supabase/supabase-js";
import { randomBytes } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { required } from "./shared.mjs";
const email = process.argv[2];
if (!email || !email.includes("@"))
  throw new Error("Provide administrator email.");
const db = createClient(
  required("NEXT_PUBLIC_SUPABASE_URL"),
  required("SUPABASE_SERVICE_ROLE_KEY"),
  { auth: { persistSession: false, autoRefreshToken: false } },
);
let user;
for (let page = 1; page <= 100; page++) {
  const { data, error } = await db.auth.admin.listUsers({ page, perPage: 100 });
  if (error) throw new Error("Could not inspect Auth users.");
  user = data.users.find((u) => u.email?.toLowerCase() === email.toLowerCase());
  if (user || data.users.length < 100) break;
}
if (!user) {
  const { data, error } = await db.auth.admin.createUser({
    email,
    email_confirm: true,
    password: randomBytes(32).toString("base64url"),
    user_metadata: { full_name: "Mihai Roman" },
  });
  if (error) throw new Error("Could not create administrator.");
  user = data.user;
}
if (!user) throw new Error("Administrator missing.");
const { error } = await db.from("organization_members").upsert(
  {
    organization_id: "10000000-0000-4000-8000-000000000001",
    user_id: user.id,
    role: "owner",
  },
  { onConflict: "organization_id,user_id" },
);
if (error) throw new Error("Could not assign owner membership.");
const { data: link, error: linkError } = await db.auth.admin.generateLink({
  type: "recovery",
  email,
});
if (linkError) throw new Error("Could not generate local account-setup link.");
await mkdir("../../work", { recursive: true });
await writeFile(
  "../../work/admin-access.json",
  JSON.stringify(
    {
      userId: user.id,
      email,
      url: `http://localhost:3000/auth/callback?token_hash=${link.properties.hashed_token}&type=recovery`,
    },
    null,
    2,
  ),
);
console.log(
  "Administrator provisioned. No email sent. One-time local access link saved privately in work/admin-access.json.",
);
