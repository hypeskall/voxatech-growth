import { NextRequest, NextResponse } from "next/server";
import { admin, check } from "@/lib/db";
import { z } from "zod";
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;
  if (!z.uuid().safeParse(token).success)
    return new NextResponse("Link invalid", { status: 404 });
  return new NextResponse(
    '<!doctype html><html lang="ro"><meta name="viewport" content="width=device-width"><title>Dezabonare · VoxaTech</title><body style="background:#0c1220;color:#eef1f8;font:18px system-ui;padding:10vh 8vw"><h1>Oprește mesajele VoxaTech</h1><p>Confirmă că nu mai dorești să primești mesaje.</p><form method="post"><button style="padding:16px 24px">Confirmă dezabonarea</button></form></body></html>',
    {
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-store",
      },
    },
  );
}
export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;
  if (!z.uuid().safeParse(token).success)
    return new NextResponse("Link invalid", { status: 404 });
  const { data: m } = await admin()
    .from("messages")
    .select("organization_id,lead_id")
    .eq("unsubscribe_token", token)
    .maybeSingle();
  if (!m) return new NextResponse("Link invalid", { status: 404 });
  check(
    await admin().rpc("suppress_lead", {
      org: m.organization_id,
      target: m.lead_id,
      reason_text: "Dezabonare prin link",
    }),
  );
  return new NextResponse(
    "Dezabonarea a fost confirmată. Nu vei mai primi mesaje VoxaTech.",
    {
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Cache-Control": "no-store",
      },
    },
  );
}
