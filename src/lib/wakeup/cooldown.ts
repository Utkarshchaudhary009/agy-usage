import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { createServerClient } from "@/lib/supabase/server";
import type { Database } from "@/lib/types/database";

const COOLDONE_BUFFER_MS = 1000;

export async function isOnCooldown(
  clerkUserId: string,
  supabase?: SupabaseClient<Database>,
): Promise<boolean> {
  const client = supabase ?? (await createServerClient());

  const { data: config } = await client
    .from("wakeup_configs")
    .select("cooldown_minutes")
    .eq("clerk_user_id", clerkUserId)
    .maybeSingle();

  if (!config?.cooldown_minutes) {
    return false;
  }

  const cooldownMs = config.cooldown_minutes * 60 * 1000;

  const { data: lastLog } = await client
    .from("wakeup_logs")
    .select("created_at")
    .eq("clerk_user_id", clerkUserId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!lastLog?.created_at) {
    return false;
  }

  const lastTriggerMs = new Date(lastLog.created_at).getTime();
  return lastTriggerMs + cooldownMs + COOLDONE_BUFFER_MS > Date.now();
}
