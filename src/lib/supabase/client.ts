"use client";

import { useSession } from "@clerk/nextjs";
import { createClient } from "@supabase/supabase-js";
import { useMemo } from "react";
import type { Database } from "../types/database";
import { requireSupabaseEnv } from "./env";

// Browser client (for Realtime subscriptions only)
export function useSupabaseClient() {
  const { session } = useSession();

  return useMemo(() => {
    const { url, anonKey } = requireSupabaseEnv();

    return createClient<Database>(url, anonKey, {
      global: {
        fetch: async (fetchUrl, options = {}) => {
          // Natively supports Clerk's Third-Party Auth integration without custom JWT templates.
          let clerkToken: string | null = null;
          try {
            clerkToken = (await session?.getToken()) ?? null;
          } catch (e: any) {
            if (e?.name === "ClerkOfflineError") {
              clerkToken = null;
            } else {
              throw e;
            }
          }

          const headers = new Headers(options?.headers);
          if (clerkToken) {
            headers.set("Authorization", `Bearer ${clerkToken}`);
          }

          return fetch(fetchUrl, { ...options, headers });
        },
      },
    });
  }, [session]);
}
