import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { session } from "@/lib/session";
import { admin, appUrl, check, log } from "@/lib/db";
import {
  gmailScopes,
  gmailStateCookie,
  sealGmailSecret,
  verifyGmailState,
} from "@/lib/gmail-security";
import { googleToken } from "@/lib/gmail-api";
export const runtime = "nodejs";
export async function GET(req: NextRequest) {
  const target = new URL("/settings/integrations", appUrl());
  try {
    const s = await session();
    if (!s || !["owner", "admin"].includes(s.role))
      throw new Error("Access denied");
    const state = verifyGmailState(
      req.cookies.get(gmailStateCookie)?.value || "",
      req.nextUrl.searchParams.get("state") || "",
      s.org,
      s.user.id,
    );
    const code = req.nextUrl.searchParams.get("code");
    if (!code || req.nextUrl.searchParams.has("error"))
      throw new Error("Authorization denied");
    const tokens = await googleToken(
      new URLSearchParams({
        client_id: process.env.GOOGLE_GMAIL_CLIENT_ID!,
        client_secret: process.env.GOOGLE_GMAIL_CLIENT_SECRET!,
        grant_type: "authorization_code",
        code,
        code_verifier: state.verifier,
        redirect_uri: `${new URL(appUrl()).origin}/api/gmail/callback`,
      }),
    );
    if (
      !tokens.refresh_token ||
      !gmailScopes
        .filter((scope) => scope.includes("gmail."))
        .every((scope) => tokens.scope?.split(" ").includes(scope))
    )
      throw new Error("Missing Google permissions");
    const response = await fetch(
      "https://openidconnect.googleapis.com/v1/userinfo",
      {
        headers: { Authorization: `Bearer ${tokens.access_token}` },
        cache: "no-store",
        signal: AbortSignal.timeout(15000),
      },
    );
    if (!response.ok) throw new Error("Identity unavailable");
    const identity = z
      .object({
        sub: z.string().min(1),
        email: z.email(),
        email_verified: z.literal(true),
      })
      .parse(await response.json());
    check(
      await admin()
        .from("gmail_accounts")
        .upsert(
          {
            organization_id: s.org,
            email: identity.email.toLowerCase(),
            google_subject: identity.sub,
            encrypted_refresh_token: sealGmailSecret(
              tokens.refresh_token,
              `${s.org}:${identity.sub}`,
            ),
            status: "connected",
            connected_by: s.user.id,
            last_verified_at: new Date().toISOString(),
            last_error: null,
            last_test_at: null,
          },
          { onConflict: "organization_id,email" },
        ),
    );
    await log(
      s.org,
      "gmail_connected",
      null,
      { email: identity.email.toLowerCase() },
      null,
      s.user.id,
    );
    target.searchParams.set("gmail", "connected");
  } catch {
    target.searchParams.set("gmail", "failed");
  }
  const response = NextResponse.redirect(target);
  response.cookies.set(gmailStateCookie, "", {
    path: "/api/gmail",
    maxAge: 0,
    httpOnly: true,
    sameSite: "lax",
    secure: new URL(appUrl()).protocol === "https:",
  });
  response.headers.set("Cache-Control", "no-store");
  response.headers.set("Referrer-Policy", "no-referrer");
  return response;
}
