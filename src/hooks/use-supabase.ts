"use client";

import { useSession } from "@clerk/nextjs";
import { createClient } from "@supabase/supabase-js";
import { useMemo } from "react";
import { requireSupabaseEnv } from "../lib/supabase/env";
import type { Database } from "../lib/types/database";

export function useSupabase() {
  const { session } = useSession();

  return useMemo(() => {
    const { url, anonKey } = requireSupabaseEnv();

    return createClient<Database>(url, anonKey, {
      global: {
        // Intercept fetch to dynamically attach the Clerk session token
        fetch: async (fetchUrl, options = {}) => {
          const clerkToken = await session?.getToken();
          const headers = new Headers(options.headers);

          if (clerkToken) {
            headers.set("Authorization", `Bearer ${clerkToken}`);
          }

          return fetch(fetchUrl, { ...options, headers });
        },
      },
    });
  }, [session]);
}
