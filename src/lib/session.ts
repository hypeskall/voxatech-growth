import "server-only";
import { createSupabaseServerClient } from "./supabase/server";
export async function session() {
  const db = await createSupabaseServerClient();
  const {
    data: { user },
    error,
  } = await db.auth.getUser();
  if (error || !user) return null;
  const { data: memberships, error: memberError } = await db
    .from("organization_members")
    .select("*")
    .eq("user_id", user.id)
    .order("created_at")
    .limit(1);
  if (memberError || !memberships?.[0]) return null;
  return {
    db,
    user,
    org: memberships[0].organization_id,
    role: memberships[0].role,
  };
}
