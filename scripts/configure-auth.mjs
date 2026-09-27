import { management } from "./shared.mjs";
const origin = new URL(process.env.APP_URL || "http://localhost:3000").origin;
if (!origin.startsWith("https://") && origin !== "http://localhost:3000")
  throw new Error("APP_URL must use HTTPS except localhost development.");
const desired = {
  site_url: origin,
  uri_allow_list: `${origin}/auth/callback`,
  disable_signup: true,
  external_email_enabled: true,
  external_anonymous_users_enabled: false,
  mailer_autoconfirm: false,
  password_min_length: 12,
  refresh_token_rotation_enabled: true,
  security_refresh_token_reuse_interval: 10,
};
await management("/config/auth", "PATCH", desired);
const actual = await management("/config/auth");
for (const [key, value] of Object.entries(desired)) {
  if (actual[key] !== value)
    throw new Error(`Auth setting did not persist: ${key}`);
}
console.log(
  "Verified invite-only email authentication, confirmed emails, password policy, token rotation, and exact callback URL.",
);
