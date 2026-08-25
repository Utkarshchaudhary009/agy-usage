import "server-only";

import { createServerClient, createServiceClient } from "@/lib/supabase/server";
import type { CooldownStatus } from "@/lib/types/wakeup";
import { defaultWakeupConfig } from "./models";

export interface WakeupJobOptions {
  /**
   * Set to true when calling from a background job (Inngest) that has no Clerk
   * request context, so the service-role client is used instead of RLS.
   */
  asBackgroundJob?: boolean;
}

export async function isOnCooldown(
  clerkUserId: string,
  options?: WakeupJobOptions,
): Promise<boolean> {
  const status = await getCooldownStatus(clerkUserId, options);
  return status.onCooldown;
}

export async function getCooldownStatus(
  clerkUserId: string,
  options?: WakeupJobOptions,
): Promise<CooldownStatus> {
  const supabase = options?.asBackgroundJob
    ? createServiceClient()
    : await createServerClient();

  const { data: config, error } = await supabase
    .from("wakeup_configs")
    .select("cooldown_minutes, last_run_started_at")
    .eq("clerk_user_id", clerkUserId)
    .maybeSingle();

  if (error) {
    // Detail stays server-side: the Postgres message leaks schema and policy
    // names, and this error can surface in a rendered error boundary.
    console.error("Failed to load wakeup config:", error);
    throw new Error("Failed to load wakeup config");
  }

  // No saved config means the user has never armed wakeup; fall back to the
  // same documented default the config UI starts from.
  const cooldownMinutes =
    config?.cooldown_minutes ?? defaultWakeupConfig().cooldownMinutes;

  // The cooldown window is anchored to when the last run *started*
  // (last_run_started_at) rather than when its log rows were written. That
  // column is stamped atomically by claim_wakeup_run() before any trigger work
  // begins, so an in-flight run is correctly counted as "on cooldown" and
  // concurrent wakeups cannot both slip past the check.
  if (!config?.last_run_started_at) {
    return {
      onCooldown: false,
      lastTriggerAt: null,
      cooldownEndsAt: null,
    };
  }

  const lastTriggerDate = new Date(config.last_run_started_at);
  const lastTriggerAt = lastTriggerDate.toISOString();
  const cooldownEndsAt = new Date(
    lastTriggerDate.getTime() + cooldownMinutes * 60 * 1000,
  );

  return {
    onCooldown: cooldownEndsAt > new Date(),
    lastTriggerAt,
    cooldownEndsAt: cooldownEndsAt.toISOString(),
  };
}
