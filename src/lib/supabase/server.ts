import "server-only";
import { auth } from "@clerk/nextjs/server";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../types/database";
import { requireSupabaseEnv } from "./env";
import { requireSupabaseServiceEnv } from "./env.server";

// Server-side clients never have a browser session to persist or refresh, so we
// disable supabase-js auth bookkeeping. Without this, createClient() reaches for
// (non-existent) web storage and wires up token auto-refresh timers that leak
// across requests in a server runtime.
const SERVER_AUTH_OPTIONS = {
  persistSession: false,
  autoRefreshToken: false,
  detectSessionInUrl: false,
} as const;

// The service-role client is stateless (no per-request auth context), so a
// single instance can be shared process-wide. Reusing it keeps one pooled
// connection set instead of opening a fresh pool on every call — important on
// the token-refresh hot path, which can fire many times per second under
// Inngest fan-out.
let serviceClientSingleton: SupabaseClient<Database> | null = null;

export async function createServerClient() {
  const { getToken } = await auth();
  const token = await getToken();

  const { url, anonKey } = requireSupabaseEnv();

  return createClient<Database>(url, anonKey, {
    auth: SERVER_AUTH_OPTIONS,
    global: {
      headers: token
        ? {
            Authorization: `Bearer ${token}`,
          }
        : undefined,
    },
  });
}

// For background jobs or cases where we don't have a user context (like Inngest)
export function createServiceClient(): SupabaseClient<Database> {
  if (serviceClientSingleton) {
    return serviceClientSingleton;
  }

  const { url, serviceKey } = requireSupabaseServiceEnv();

  serviceClientSingleton = createClient<Database>(url, serviceKey, {
    auth: SERVER_AUTH_OPTIONS,
  });

  return serviceClientSingleton;
}
