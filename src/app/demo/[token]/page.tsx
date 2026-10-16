import { notFound } from "next/navigation";
import { z } from "zod";
import { admin, check } from "@/lib/db";
import { DemoPlayer } from "@/components/demo-player";
import { BrandMark } from "@/components/brand-mark";
export const dynamic = "force-dynamic";
export default async function Page({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  if (!z.uuid().safeParse(token).success) notFound();
  const { data: demo } = await admin()
    .from("demos")
    .select("*")
    .eq("share_token", token)
    .is("revoked_at", null)
    .maybeSingle();
  if (!demo || (demo.expires_at && new Date(demo.expires_at) < new Date()))
    notFound();
  const lead = check(
    await admin()
      .from("leads")
      .select("company_name")
      .eq("id", demo.lead_id)
      .single(),
  );
  const script = z
    .object({
      turns: z.array(z.object({ role: z.string(), text: z.string() })),
    })
    .safeParse(demo.script);
  const segments = z
    .array(z.object({ path: z.string() }))
    .safeParse(demo.audio_segments);
  const audio: string[] = [];
  if (segments.success && demo.status === "ready")
    for (const s of segments.data) {
      const signed = check(
        await admin().storage.from("voxa-demos").createSignedUrl(s.path, 1800),
      );
      audio.push(signed.signedUrl);
    }
  const seen = check(
    await admin()
      .from("demos")
      .update({ viewed_at: new Date().toISOString() })
      .eq("id", demo.id)
      .is("viewed_at", null)
      .select("id"),
  );
  if (seen.length)
    check(
      await admin()
        .from("activities")
        .insert({
          organization_id: demo.organization_id,
          lead_id: demo.lead_id,
          action: "demo_viewed",
          details: { demo_id: demo.id },
        }),
    );
  return (
    <main className="public-wrap">
      <div className="brand">
        <BrandMark />
        <div>
          Voxa
        </div>
      </div>
      <DemoPlayer
        token={token}
        company={lead.company_name}
        turns={script.success ? script.data.turns : []}
        audio={audio}
        status={demo.status}
      />
      <p className="login-footer">
        VoxaTech · O recepție disponibilă pentru pacienții tăi.
      </p>
    </main>
  );
}
