import "server-only";
import { createServerClient, createServiceClient } from "@/lib/supabase/server";
import type { CooldownStatus } from "@/lib/types/wakeup";

export async function isOnCooldown(
  clerkUserId: string,
  options?: { asBackgroundJob?: boolean },
): Promise<boolean> {
  const status = await getCooldownStatus(clerkUserId, options);
  return status.onCooldown;
}

export async function getCooldownStatus(
  clerkUserId: string,
  options?: { asBackgroundJob?: boolean },
): Promise<CooldownStatus> {
  const supabase = options?.asBackgroundJob
    ? createServiceClient()
    : await createServerClient();

  const { data: config, error: configError } = await supabase
    .from("wakeup_configs")
    .select("cooldown_minutes, last_run_started_at")
    .eq("clerk_user_id", clerkUserId)
    .maybeSingle();

  if (configError) {
    console.error("Failed to load wakeup config:", configError);
    throw new Error("Failed to load wakeup config");
  }

  const cooldownMinutes = config?.cooldown_minutes ?? 60;

  // The cooldown window is anchored to when the last run *started*
  // (last_run_started_at) rather than when its log row was written. That column
  // is stamped atomically by claim_wakeup_run() before any trigger work begins,
  // so an in-flight run is correctly counted as "on cooldown" and concurrent
  // wakeups cannot both slip past the check.
  if (!config?.last_run_started_at) {
    return {
      onCooldown: false,
      lastTriggerAt: null,
      cooldownEndsAt: null,
    };
  }

  const lastTriggerAt = new Date(config.last_run_started_at);
  const cooldownEndsAt = new Date(
    lastTriggerAt.getTime() + cooldownMinutes * 60 * 1000,
  );

  return {
    onCooldown: cooldownEndsAt > new Date(),
    lastTriggerAt: config.last_run_started_at,
    cooldownEndsAt: cooldownEndsAt.toISOString(),
  };
}
