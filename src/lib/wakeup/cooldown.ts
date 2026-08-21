import "server-only";

import { createServerClient, createServiceClient } from "@/lib/supabase/server";

// Used when no wakeup config exists yet so we still honour a sane default.
const DEFAULT_COOLDOWN_MINUTES = 60;

export interface CooldownStatus {
  onCooldown: boolean;
  cooldownMinutes: number;
  lastTriggerAt: Date | null;
  nextAllowedAt: Date | null;
}

/**
 * Computes the current cooldown state for a user based on their configured
 * `cooldown_minutes` and the most recent `wakeup_logs` row. The cooldown
 * prevents a user's scheduled and manual wakeups from stampeding the Cloud Code
 * API within a short window.
 *
 * Defaults to the RLS-scoped server client so reads honour the caller's
 * identity. Pass `asBackgroundJob: true` (e.g. from an Inngest worker) to use
 * the service-role client when no Clerk session is available.
 */
export async function getCooldownStatus(
  clerkUserId: string,
  asBackgroundJob = false,
): Promise<CooldownStatus> {
  const supabase = asBackgroundJob
    ? createServiceClient()
    : await createServerClient();

  const { data: config } = await supabase
    .from("wakeup_configs")
    .select("cooldown_minutes")
    .eq("clerk_user_id", clerkUserId)
    .maybeSingle();

  const cooldownMinutes = config?.cooldown_minutes ?? DEFAULT_COOLDOWN_MINUTES;

  const { data: lastLog } = await supabase
    .from("wakeup_logs")
    .select("created_at")
    .eq("clerk_user_id", clerkUserId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!lastLog) {
    return {
      onCooldown: false,
      cooldownMinutes,
      lastTriggerAt: null,
      nextAllowedAt: null,
    };
  }

  const lastTriggerAt = new Date(lastLog.created_at);
  const nextAllowedAt = new Date(
    lastTriggerAt.getTime() + cooldownMinutes * 60_000,
  );

  return {
    onCooldown: nextAllowedAt.getTime() > Date.now(),
    cooldownMinutes,
    lastTriggerAt,
    nextAllowedAt,
  };
}

export async function isOnCooldown(
  clerkUserId: string,
  asBackgroundJob = false,
): Promise<boolean> {
  const status = await getCooldownStatus(clerkUserId, asBackgroundJob);
  return status.onCooldown;
}

/** Milliseconds remaining until the cooldown clears (0 when not on cooldown). */
export async function getCooldownRemainingMs(
  clerkUserId: string,
  asBackgroundJob = false,
): Promise<number> {
  const status = await getCooldownStatus(clerkUserId, asBackgroundJob);
  if (!status.nextAllowedAt) return 0;
  return Math.max(0, status.nextAllowedAt.getTime() - Date.now());
}
