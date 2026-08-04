import "server-only";

import { createServerClient } from "@/lib/supabase/server";

export async function isOnCooldown(clerkUserId: string): Promise<boolean> {
  const supabase = await createServerClient();

  const { data: config, error: configError } = await supabase
    .from("wakeup_configs")
    .select("cooldown_minutes")
    .eq("clerk_user_id", clerkUserId)
    .single();

  if (configError || !config) {
    return false;
  }

  const cooldownMs = config.cooldown_minutes * 60 * 1000;
  const cooldownUntil = new Date(Date.now() - cooldownMs).toISOString();

  const { data: lastLog, error: logError } = await supabase
    .from("wakeup_logs")
    .select("created_at")
    .eq("clerk_user_id", clerkUserId)
    .gte("created_at", cooldownUntil)
    .order("created_at", { ascending: false })
    .limit(1)
    .single();

  if (logError && logError.code !== "PGRST116") {
    throw new Error(
      `Failed to check cooldown: ${logError.message}`,
    );
  }

  return !!lastLog;
}
