import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { admin, check } from "@/lib/db";
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;
  if (!z.uuid().safeParse(token).success)
    return NextResponse.json({ error: "Invalid" }, { status: 404 });
  const event = z
    .object({ event: z.literal("listened") })
    .safeParse(await req.json().catch(() => null));
  if (!event.success)
    return NextResponse.json({ error: "Invalid" }, { status: 400 });
  const { data: d } = await admin()
    .from("demos")
    .select("id,organization_id,lead_id,expires_at")
    .eq("share_token", token)
    .is("revoked_at", null)
    .eq("status", "ready")
    .maybeSingle();
  if (!d || (d.expires_at && new Date(d.expires_at) < new Date()))
    return NextResponse.json({ error: "Indisponibil" }, { status: 404 });
  const changed = check(
    await admin()
      .from("demos")
      .update({ listened_at: new Date().toISOString() })
      .eq("id", d.id)
      .is("listened_at", null)
      .select("id"),
  );
  if (changed.length)
    check(
      await admin()
        .from("activities")
        .insert({
          organization_id: d.organization_id,
          lead_id: d.lead_id,
          action: "demo_listened",
          details: { demo_id: d.id },
        }),
    );
  return NextResponse.json({ ok: true });
}
