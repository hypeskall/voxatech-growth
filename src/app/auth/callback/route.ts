import { NextRequest, NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { z } from "zod";
import { appUrl } from "@/lib/db";
export async function GET(request: NextRequest) {
  const token = request.nextUrl.searchParams.get("token_hash");
  const type = z
    .enum(["invite", "recovery", "magiclink", "email"])
    .safeParse(request.nextUrl.searchParams.get("type"));
  if (token && type.success) {
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase.auth.verifyOtp({
      token_hash: token,
      type: type.data,
    });
    if (!error) return NextResponse.redirect(new URL("/settings", appUrl()));
  }
  const code = request.nextUrl.searchParams.get("code");
  if (code) {
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) return NextResponse.redirect(new URL("/dashboard", appUrl()));
  }
  return NextResponse.json(
    { error: "Link de autentificare invalid sau expirat." },
    { status: 400, headers: { "Cache-Control": "no-store" } },
  );
}
