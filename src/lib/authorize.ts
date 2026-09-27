import "server-only";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { z } from "zod";
export async function authorize(organizationId: string) {
  const id = z.uuid().parse(organizationId);
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();
  if (error || !user) return null;
  const { data: membership, error: membershipError } = await supabase
    .from("organization_members")
    .select("role")
    .eq("organization_id", id)
    .eq("user_id", user.id)
    .maybeSingle();
  if (membershipError || !membership) return null;
  return {
    supabase,
    user,
    organizationId: id,
    role: membership.role as "owner" | "admin" | "operator" | "viewer",
  };
}
