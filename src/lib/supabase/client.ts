import { createClient } from "@supabase/supabase-js";
import type { Database } from "../types/database";

// Browser client (for Realtime subscriptions only)
export function createBrowserClient(clerkSessionToken?: string) {
  if (
    !process.env.NEXT_PUBLIC_SUPABASE_URL ||
    !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  ) {
    throw new Error("Missing Supabase env vars");
  }

  return createClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    {
      global: {
        headers: clerkSessionToken
          ? {
              Authorization: `Bearer ${clerkSessionToken}`,
            }
          : undefined,
      },
    },
  );
}
