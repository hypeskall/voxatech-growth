import { NextRequest, NextResponse } from "next/server";
import { session } from "@/lib/session";
import { appUrl } from "@/lib/db";
import {
  createGmailState,
  gmailConfigurationReady,
  gmailScopes,
  gmailStateCookie,
} from "@/lib/gmail-security";
export const runtime = "nodejs";
export async function POST(req: NextRequest) {
  if (req.headers.get("origin") !== new URL(appUrl()).origin)
    return NextResponse.json({ error: "Origine nepermisă." }, { status: 403 });
  const s = await session();
  if (!s || !["owner", "admin"].includes(s.role))
    return NextResponse.json(
      { error: "Este necesar un administrator autentificat." },
      { status: 403 },
    );
  if (!gmailConfigurationReady())
    return NextResponse.json(
      {
        error:
          "Conectarea Gmail necesită configurarea aplicației Google și a adresei interne de test.",
      },
      { status: 400 },
    );
  const state = createGmailState(s.org, s.user.id);
  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  url.search = new URLSearchParams({
    client_id: process.env.GOOGLE_GMAIL_CLIENT_ID!,
    redirect_uri: `${new URL(appUrl()).origin}/api/gmail/callback`,
    response_type: "code",
    scope: gmailScopes.join(" "),
    access_type: "offline",
    prompt: "consent select_account",
    state: state.state,
    code_challenge: state.challenge,
    code_challenge_method: "S256",
  }).toString();
  const response = NextResponse.json(
    { url: url.href },
    { headers: { "Cache-Control": "no-store" } },
  );
  response.cookies.set(gmailStateCookie, state.cookie, {
    httpOnly: true,
    secure: new URL(appUrl()).protocol === "https:",
    sameSite: "lax",
    path: "/api/gmail",
    maxAge: 600,
  });
  return response;
}
