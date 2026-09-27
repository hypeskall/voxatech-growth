import { NextRequest, NextResponse } from "next/server";
import { session } from "@/lib/session";
import { appUrl } from "@/lib/db";
import { runWorker } from "@/lib/automation";
export const maxDuration = 300;
export async function POST(req: NextRequest) {
  if (req.headers.get("origin") !== new URL(appUrl()).origin)
    return NextResponse.json({ error: "Origine nepermisă" }, { status: 403 });
  const s = await session();
  if (!s || !["owner", "admin"].includes(s.role))
    return NextResponse.json({ error: "Neautorizat" }, { status: 403 });
  try {
    return NextResponse.json({ results: await runWorker(s.org) });
  } catch {
    return NextResponse.json({ error: "Procesarea a eșuat." }, { status: 500 });
  }
}
