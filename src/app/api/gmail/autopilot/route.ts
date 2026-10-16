import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { session } from "@/lib/session";
import { admin, appUrl, check, log, safeError } from "@/lib/db";
import { gmailConfigurationReady } from "@/lib/gmail-security";
import { approvedOutreachTemplate } from "@/lib/outreach-template";
import { syncGmail } from "@/lib/gmail-sync";
export const runtime = "nodejs";
export const maxDuration = 120;
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
      .object({
        action: z.enum(["start", "pause", "sync"]),
        confirmed: z.boolean().optional(),
        lead_list_id: z.uuid().optional(),
      })
      .parse(await req.json());
    if (input.action === "sync")
      return NextResponse.json(
        { results: await syncGmail(s.org) },
        { headers: { "Cache-Control": "no-store" } },
      );
    const accounts = check(
      await admin()
        .from("gmail_accounts")
        .select("*")
        .eq("organization_id", s.org),
    );
    // Freeze the managed pipeline until all campaign changes have succeeded.
    if (input.action === "start") {
      if (!input.confirmed)
        throw new Error(
          "Confirmă mesajul și trimiterea automată înainte de pornire.",
        );
      if (!input.lead_list_id)
        throw new Error("Alege campania cu leaduri înainte de pornire.");
      if (
        !gmailConfigurationReady() ||
        !process.env.GEMINI_API_KEY ||
        (process.env.AUTOPILOT_CRON_SECRET?.length || 0) < 32
      )
        throw new Error(
          "Configurează Google, Gemini, adresa de test și programarea automată înainte de pornire.",
        );
      if (process.env.EMAIL_DELIVERY_MODE !== "live")
        throw new Error(
          "Livrarea este în modul de test. Activează livrarea Gmail după verificarea unui test intern.",
        );
      if (!accounts.some((account) => account.status === "connected"))
        throw new Error("Conectează cel puțin o căsuță Gmail.");
      if (
        accounts.some(
          (account) => account.status === "connected" && !account.last_test_at,
        )
      )
        throw new Error(
          "Trimite un test intern din fiecare căsuță conectată înainte de pornirea Autopilot.",
        );
    }
    check(
      input.action === "start"
        ? await s.db.rpc("start_gmail_lead_list", {
            org: s.org,
            target: input.lead_list_id!,
            initial_template: approvedOutreachTemplate,
          })
        : await s.db.rpc("set_gmail_autopilot", {
            org: s.org,
            should_run: false,
            initial_template: approvedOutreachTemplate,
          }),
    );
    if (input.action === "start") {
      check(await admin().rpc("schedule_gmail_autopilot", { org: s.org }));
    }
    await log(
      s.org,
      `gmail_autopilot_${input.action}`,
      null,
      { automatic_delivery: input.action === "start" },
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
