import "server-only";
import { auth } from "@clerk/nextjs/server";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "../types/database";
import { requireSupabaseEnv, requireSupabaseServiceEnv } from "./env";

export async function createServerClient() {
  const { getToken } = await auth();
  const token = await getToken();

  const { url, anonKey } = requireSupabaseEnv();

  return createClient<Database>(url, anonKey, {
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
export function createServiceClient() {
  const { url, serviceKey } = requireSupabaseServiceEnv();

  return createClient<Database>(url, serviceKey);
}
