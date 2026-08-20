import "server-only";

import { createServiceClient } from "@/lib/supabase/server";

export interface CooldownInfo {
  onCooldown: boolean;
  nextAllowedAt?: string;
}

export async function isOnCooldown(clerkUserId: string): Promise<CooldownInfo> {
  const supabase = createServiceClient();

  const { data: config } = await supabase
    .from("wakeup_configs")
    .select("cooldown_minutes")
    .eq("clerk_user_id", clerkUserId)
    .single();

  const cooldownMinutes = config?.cooldown_minutes ?? 60;

  const { data: lastLog } = await supabase
    .from("wakeup_logs")
    .select("created_at")
    .eq("clerk_user_id", clerkUserId)
    .order("created_at", { ascending: false })
    .limit(1)
    .single();

  if (!lastLog) {
    return { onCooldown: false };
  }

  const lastTriggerTime = new Date(lastLog.created_at);
  const now = new Date();
  const cooldownMs = cooldownMinutes * 60 * 1000;

  const isOnCooldown = now.getTime() - lastTriggerTime.getTime() < cooldownMs;

  if (isOnCooldown) {
    const nextAllowed = new Date(lastTriggerTime);
    nextAllowed.setMinutes(nextAllowed.getMinutes() + cooldownMinutes);

    return {
      onCooldown: true,
      nextAllowedAt: nextAllowed.toISOString(),
    };
  }

  return { onCooldown: false };
}
