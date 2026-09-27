import { NextRequest, NextResponse } from "next/server";
import { authorize } from "@/lib/authorize";
import { z } from "zod";
export const dynamic = "force-dynamic";
export async function GET(request: NextRequest) {
  const parsed = z
    .uuid()
    .safeParse(request.nextUrl.searchParams.get("organization_id"));
  if (!parsed.success)
    return NextResponse.json(
      { error: "Organizație invalidă." },
      { status: 400 },
    );
  const session = await authorize(parsed.data);
  if (!session)
    return NextResponse.json(
      { error: "Autentificare și acces la organizație necesare." },
      { status: 401 },
    );
  const { error } = await session.supabase
    .from("leads")
    .select("id", { count: "exact", head: true })
    .eq("organization_id", parsed.data);
  return NextResponse.json(
    { connected: !error },
    { status: error ? 503 : 200, headers: { "Cache-Control": "no-store" } },
  );
}
