import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { admin, check, log } from "@/lib/db";
const schema = z.object({
  clinic: z.string().min(2).max(10000),
  contact: z.string().min(3).max(10000),
  services: z.string().min(2).max(10000),
  schedule: z.string().min(2).max(10000),
  greeting: z.string().min(2).max(10000),
  transfer: z.string().min(2).max(10000),
  appointments: z.string().min(2).max(10000),
  calendar: z.string().min(2).max(10000),
});
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;
  if (!z.uuid().safeParse(token).success)
    return NextResponse.json({ error: "Invalid" }, { status: 404 });
  const raw = await req.text();
  if (raw.length > 85000)
    return NextResponse.json({ error: "Prea mare" }, { status: 413 });
  try {
    const input = schema.parse(JSON.parse(raw));
    const { data: r } = await admin()
      .from("onboarding_records")
      .select("id,organization_id,lead_id,expires_at,status")
      .eq("share_token", token)
      .maybeSingle();
    if (!r || new Date(r.expires_at) < new Date())
      return NextResponse.json({ error: "Expirat" }, { status: 404 });
    if (r.status === "completed") return NextResponse.json({ ok: true });
    const changed = check(
      await admin()
        .from("onboarding_records")
        .update({
          clinic_data: { text: input.clinic },
          contact_person: { text: input.contact },
          services: [input.services],
          schedule: { text: input.schedule },
          preferred_greeting: input.greeting,
          transfer_rules: input.transfer,
          appointment_rules: input.appointments,
          calendar_setup: { text: input.calendar },
          status: "completed",
        })
        .eq("id", r.id)
        .neq("status", "completed")
        .select("id"),
    );
    if (changed.length)
      await log(r.organization_id, "onboarding_completed", r.lead_id);
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "Date invalide" }, { status: 400 });
  }
}
