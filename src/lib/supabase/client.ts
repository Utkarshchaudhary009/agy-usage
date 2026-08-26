"use client";

import { useSession } from "@clerk/nextjs";
import { createClient } from "@supabase/supabase-js";
import { useMemo } from "react";
import type { Database } from "../types/database";
import { requireSupabaseEnv } from "./env";

// Browser client (for Realtime subscriptions and authenticated REST calls)
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
          } catch (e: unknown) {
            if (e instanceof Error && e.name === "ClerkOfflineError") {
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
      // Realtime websockets bypass the fetch override above entirely — channel
      // authorization uses this token directly. Without it, postgres_changes
      // subscriptions join as anon and RLS-filtered tables deliver nothing.
      accessToken: async () => {
        try {
          return (await session?.getToken()) ?? null;
        } catch (e: unknown) {
          if (e instanceof Error && e.name === "ClerkOfflineError") {
            return null;
          }
          throw e;
        }
      },
    });
  }, [session]);
}
