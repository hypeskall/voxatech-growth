"use client";
import { createBrowserClient } from "@supabase/ssr";
import type { Database } from "./database.types";
export function createSupabaseBrowserClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) throw new Error("Configurația Supabase lipsește.");
  return createBrowserClient<Database>(url, key);
}
