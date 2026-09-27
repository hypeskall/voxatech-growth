import "server-only";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";
import type { Database } from "./database.types";
// Reserved for trusted workers and administrative operations. Normal requests use RLS.
export function createSupabaseAdminClient() {
  return createClient<Database>(
    z.url().parse(process.env.NEXT_PUBLIC_SUPABASE_URL),
    z.string().min(1).parse(process.env.SUPABASE_SERVICE_ROLE_KEY),
    {
      auth: { persistSession: false, autoRefreshToken: false },
    },
  );
}
