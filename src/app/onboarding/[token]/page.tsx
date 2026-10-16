import { notFound } from "next/navigation";
import { z } from "zod";
import { admin } from "@/lib/db";
import { OnboardingForm } from "@/components/onboarding";
import { BrandMark } from "@/components/brand-mark";
export const dynamic = "force-dynamic";
export default async function Page({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  if (!z.uuid().safeParse(token).success) notFound();
  const { data: r } = await admin()
    .from("onboarding_records")
    .select("status,expires_at")
    .eq("share_token", token)
    .maybeSingle();
  if (!r || new Date(r.expires_at) < new Date()) notFound();
  return (
    <main className="public-wrap">
      <div className="brand">
        <BrandMark />
        <div>
          Voxa
        </div>
      </div>
      <h1>Hai să pregătim recepția ta AI.</h1>
      <p className="muted" style={{ margin: "14px 0 30px" }}>
        Informațiile care ne ajută să configurăm experiența clinicii tale.
      </p>
      <OnboardingForm token={token} complete={r.status === "completed"} />
    </main>
  );
}
