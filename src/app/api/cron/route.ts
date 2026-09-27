import { timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { runWorker } from "@/lib/automation";
export const maxDuration = 300;
export const dynamic = "force-dynamic";
export async function GET(request: NextRequest) {
  const expected = process.env.CRON_SECRET;
  const supplied = request.headers.get("authorization") || "";
  const token = `Bearer ${expected}`;
  if (
    !expected ||
    expected.length < 32 ||
    supplied.length !== token.length ||
    !timingSafeEqual(Buffer.from(supplied), Buffer.from(token))
  )
    return NextResponse.json({ error: "Neautorizat." }, { status: 401 });
  try {
    return NextResponse.json({ results: await runWorker() });
  } catch {
    return NextResponse.json(
      { error: "Automatizarea nu a putut porni." },
      { status: 500 },
    );
  }
}
