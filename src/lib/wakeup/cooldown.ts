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
    .maybeSingle();

  const cooldownMinutes = config?.cooldown_minutes ?? 60;

  const { data: lastLog } = await supabase
    .from("wakeup_logs")
    .select("created_at")
    .eq("clerk_user_id", clerkUserId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

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

export interface BeginAttemptResult {
  allowed: boolean;
  nextAllowedAt?: string;
  attemptId?: string;
}

async function getConfigCooldownMinutes(clerkUserId: string): Promise<number> {
  const supabase = createServiceClient();
  const { data } = await supabase
    .from("wakeup_configs")
    .select("cooldown_minutes")
    .eq("clerk_user_id", clerkUserId)
    .maybeSingle();
  return data?.cooldown_minutes ?? 60;
}

// Atomically claim a cooldown slot for `clerkUserId`. This combines the
// cooldown check and the reservation into one serialized, transactional step
// (see `begin_wakeup_attempt`), eliminating the check-then-act race where two
// overlapping triggers could both pass the cooldown and fire. The caller must
// later release the slot with `endWakeupAttempt` once the real per-model log
// rows have been written.
export async function beginWakeupAttempt(
  clerkUserId: string,
  cooldownMinutes?: number,
): Promise<BeginAttemptResult> {
  const supabase = createServiceClient();

  const minutes =
    cooldownMinutes ?? (await getConfigCooldownMinutes(clerkUserId));

  const { data, error } = await supabase.rpc("begin_wakeup_attempt", {
    p_clerk_user_id: clerkUserId,
    p_cooldown_minutes: minutes,
  });

  if (error) {
    console.error("begin_wakeup_attempt failed:", error);
    // Fail closed: if we cannot claim the slot, refuse to trigger rather than
    // risk bypassing the cooldown.
    return { allowed: false };
  }

  const row = data?.[0];
  if (!row) {
    return { allowed: false };
  }

  return {
    allowed: row.allowed,
    nextAllowedAt: row.next_allowed_at ?? undefined,
    attemptId: row.attempt_id ?? undefined,
  };
}

// Releases a cooldown slot reserved by `beginWakeupAttempt`. Should be called
// after the real per-model log rows are persisted so the cooldown is then based
// on the actual trigger time rather than the reservation. Deleting an already
// deleted (or never created) id is a harmless no-op.
export async function endWakeupAttempt(attemptId: string): Promise<void> {
  const supabase = createServiceClient();
  const { error } = await supabase.rpc("end_wakeup_attempt", {
    p_attempt_id: attemptId,
  });
  if (error) {
    console.error("end_wakeup_attempt failed:", error);
  }
}
