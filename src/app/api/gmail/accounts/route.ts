import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { session } from "@/lib/session";
import { admin, appUrl, check, log, safeError } from "@/lib/db";
import { openGmailSecret } from "@/lib/gmail-security";
import { sendGmail } from "@/lib/providers/gmail";
import { internalTestRecipient } from "@/lib/internal-test-email";
export const runtime = "nodejs";
export async function POST(req: NextRequest) {
  if (req.headers.get("origin") !== new URL(appUrl()).origin)
    return NextResponse.json({ error: "Origine nepermisă." }, { status: 403 });
  const s = await session();
  if (!s || !["owner", "admin"].includes(s.role))
    return NextResponse.json(
      { error: "Administrator necesar." },
      { status: 403 },
    );
  try {
    const input = z
      .discriminatedUnion("action", [
        z.object({ action: z.literal("disconnect"), id: z.uuid() }),
        z.object({ action: z.literal("test"), id: z.uuid() }),
        z.object({
          action: z.literal("limit"),
          id: z.uuid(),
          daily_cap: z.number().int().min(1).max(10),
        }),
      ])
      .parse(await req.json());
    const account = check(
      await admin()
        .from("gmail_accounts")
        .select("*")
        .eq("organization_id", s.org)
        .eq("id", input.id)
        .single(),
    );
    if (input.action === "test") {
      const to = internalTestRecipient(process.env.INTERNAL_TEST_EMAIL);
      const prospects = check(
        await admin()
          .from("leads")
          .select("id")
          .eq("organization_id", s.org)
          .eq("normalized_email", to)
          .limit(1),
      );
      if (prospects.length)
        throw new Error(
          "Adresa internă de test apare în leaduri. Configurează o căsuță proprie pentru test.",
        );
      await sendGmail(account, {
        to,
        subject: "[TEST INTERN] Conectarea Gmail Voxa",
        text: `Acesta este un test intern Voxa trimis din ${account.email}. Conectarea Gmail funcționează. Nu a fost contactat niciun lead.`,
        key: `mailbox-test:${account.id}:${crypto.randomUUID()}`,
      });
      check(
        await admin()
          .from("gmail_accounts")
          .update({ last_test_at: new Date().toISOString() })
          .eq("organization_id", s.org)
          .eq("id", account.id),
      );
    } else if (input.action === "limit") {
      check(
        await admin()
          .from("gmail_accounts")
          .update({
            daily_cap: input.daily_cap,
            updated_at: new Date().toISOString(),
          })
          .eq("organization_id", s.org)
          .eq("id", account.id),
      );
      if (account.campaign_id)
        check(
          await s.db
            .from("campaigns")
            .update({ daily_cap: input.daily_cap })
            .eq("organization_id", s.org)
            .eq("id", account.campaign_id),
        );
    } else {
      check(
        await admin()
          .from("gmail_accounts")
          .update({
            status: "disconnected",
            encrypted_refresh_token: null,
            last_error: null,
            updated_at: new Date().toISOString(),
          })
          .eq("organization_id", s.org)
          .eq("id", account.id),
      );
      if (account.campaign_id)
        check(
          await s.db
            .from("campaigns")
            .update({ status: "paused" })
            .eq("organization_id", s.org)
            .eq("id", account.campaign_id),
        );
      if (account.encrypted_refresh_token)
        try {
          const token = openGmailSecret(
            account.encrypted_refresh_token,
            `${s.org}:${account.google_subject}`,
          );
          await fetch("https://oauth2.googleapis.com/revoke", {
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            body: new URLSearchParams({ token }),
            signal: AbortSignal.timeout(10000),
          });
        } catch {
          /* Local credentials are already removed; Google access can also be revoked in the user's Google account. */
        }
    }
    await log(
      s.org,
      `gmail_${input.action}`,
      null,
      { account_id: account.id },
      null,
      s.user.id,
    );
    return NextResponse.json(
      { ok: true },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return NextResponse.json({ error: safeError(error) }, { status: 400 });
  }
}
