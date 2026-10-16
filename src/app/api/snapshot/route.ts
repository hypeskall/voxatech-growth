import { NextResponse } from "next/server";
import { session } from "@/lib/session";
import { getSnapshot } from "@/lib/snapshot";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  const s = await session();
  if (!s)
    return NextResponse.json(
      { error: "Autentificare necesară." },
      { status: 401 },
    );
  try {
    return NextResponse.json(await getSnapshot(s, new URL(request.url).searchParams.get("path") || ""), {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch {
    return NextResponse.json(
      { error: "Datele nu au putut fi încărcate." },
      { status: 503 },
    );
  }
}
