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
    .select("cooldown_minutes")
    .eq("clerk_user_id", clerkUserId)
    .maybeSingle();

  if (configError) {
    throw new Error(`Failed to load wakeup config: ${configError.message}`);
  }

  const cooldownMinutes = config?.cooldown_minutes ?? 60;

  const { data: lastLog, error: logError } = await supabase
    .from("wakeup_logs")
    .select("created_at")
    .eq("clerk_user_id", clerkUserId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (logError) {
    throw new Error(`Failed to check cooldown: ${logError.message}`);
  }

  if (!lastLog) {
    return {
      onCooldown: false,
      lastTriggerAt: null,
      cooldownEndsAt: null,
    };
  }

  const lastTriggerAt = new Date(lastLog.created_at);
  const cooldownEndsAt = new Date(
    lastTriggerAt.getTime() + cooldownMinutes * 60 * 1000,
  );

  return {
    onCooldown: cooldownEndsAt > new Date(),
    lastTriggerAt: lastLog.created_at,
    cooldownEndsAt: cooldownEndsAt.toISOString(),
  };
}
