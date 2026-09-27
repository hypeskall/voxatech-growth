import "server-only";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { z } from "zod";
import type { Database } from "./database.types";
export async function createSupabaseServerClient() {
  const url = z.url().parse(process.env.NEXT_PUBLIC_SUPABASE_URL);
  const key = z
    .string()
    .min(1)
    .parse(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
  const jar = await cookies();
  return createServerClient<Database>(url, key, {
    cookies: {
      getAll: () => jar.getAll(),
      setAll: (items) => {
        try {
          for (const { name, value, options } of items)
            jar.set(name, value, options);
        } catch {
          /* Server-component refresh cookies are persisted by proxy.ts. */
        }
      },
    },
  });
}
