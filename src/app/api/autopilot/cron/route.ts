import { timingSafeEqual } from "node:crypto";
import { runAutopilot } from "@/lib/autopilot";
import { runWorker } from "@/lib/automation";
import { admin, check } from "@/lib/db";
import { syncGmail } from "@/lib/gmail-sync";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;
export async function GET(request: Request) {
  const secret = process.env.AUTOPILOT_CRON_SECRET;
  const supplied = Buffer.from(request.headers.get("authorization") || "");
  const expected = Buffer.from(`Bearer ${secret}`);
  if (
    !secret ||
    secret.length < 32 ||
    supplied.length !== expected.length ||
    !timingSafeEqual(supplied, expected)
  )
    return Response.json({ error: "Neautorizat." }, { status: 401 });
  try {
    const gmailRunning = check(
      await admin()
        .from("gmail_autopilot_settings")
        .select("organization_id")
        .eq("enabled", true),
    );
    const results = gmailRunning.length ? await runWorker() : await syncGmail();
    const legacy = check(
      await admin()
        .from("autopilot_settings")
        .select("organization_id")
        .eq("enabled", true)
        .limit(1),
    );
    return Response.json(
      { results, ...(legacy.length ? { research: await runAutopilot() } : {}) },
      {
        headers: { "Cache-Control": "no-store" },
      },
    );
  } catch {
    return Response.json(
      {
        error:
          "Autopilot nu poate porni; verifică configurația și baza de date.",
      },
      { status: 500 },
    );
  }
}
