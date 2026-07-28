import { createClient } from "@supabase/supabase-js";
import type { Database } from "../types/database";
import { requireSupabaseEnv } from "./env";

// Browser client (for Realtime subscriptions only)
export function createBrowserClient(clerkSessionToken?: string) {
  const { url, anonKey } = requireSupabaseEnv();

  return createClient<Database>(url, anonKey, {
    global: {
      headers: clerkSessionToken
        ? {
            Authorization: `Bearer ${clerkSessionToken}`,
          }
        : undefined,
    },
  });
}
