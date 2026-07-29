"use client";

import { createClient } from "@supabase/supabase-js";
import type { Database } from "../types/database";
import { requireSupabaseEnv } from "./env";

// Browser client (for Realtime subscriptions only)
export function createBrowserClient() {
  const { url, anonKey } = requireSupabaseEnv();

  return createClient<Database>(url, anonKey, {
    global: {
      fetch: async (fetchUrl, options = {}) => {
        // Use the global window.Clerk object to dynamically fetch the token.
        // This natively supports Clerk's Third-Party Auth integration without custom JWT templates.
        // biome-ignore lint/suspicious/noExplicitAny: window.Clerk is injected by ClerkProvider
        const clerkToken = await (window as any).Clerk?.session?.getToken();

        const headers = new Headers(options?.headers);
        if (clerkToken) {
          headers.set("Authorization", `Bearer ${clerkToken}`);
        }

        return fetch(fetchUrl, { ...options, headers });
      },
    },
  });
}
