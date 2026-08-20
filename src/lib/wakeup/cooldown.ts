import "server-only";

import { createServiceClient } from "@/lib/supabase/server";

export interface BeginAttemptResult {
  allowed: boolean;
  nextAllowedAt?: string;
  attemptId?: string;
}

// Atomically claim a cooldown slot for `clerkUserId`. This combines the
// cooldown check and the reservation into one serialized, transactional step
// (see `begin_wakeup_attempt`), eliminating the check-then-act race where two
// overlapping triggers could both pass the cooldown and fire. The caller must
// later release the slot with `endWakeupAttempt` once the real per-model log
// rows have been written.
//
// The configured cooldown window is read inside the RPC itself (falling back to
// 60 minutes when no config row exists), so a failure to read the config in the
// application layer can never silently bypass a longer configured cooldown.
export async function beginWakeupAttempt(
  clerkUserId: string,
  cooldownMinutes?: number,
): Promise<BeginAttemptResult> {
  const supabase = createServiceClient();

  const { data, error } = await supabase.rpc("begin_wakeup_attempt", {
    p_clerk_user_id: clerkUserId,
    p_cooldown_minutes: cooldownMinutes,
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
// deleted (or never created) id is a harmless no-op. We retry a few times
// because an orphaned reservation would otherwise pin the user on cooldown
// indefinitely.
export async function endWakeupAttempt(attemptId: string): Promise<void> {
  const supabase = createServiceClient();
  let lastError: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    const { error } = await supabase.rpc("end_wakeup_attempt", {
      p_attempt_id: attemptId,
    });
    if (!error) return;
    lastError = error;
    console.error(
      "end_wakeup_attempt failed (attempt %d):",
      attempt + 1,
      error,
    );
  }
  console.error("end_wakeup_attempt gave up releasing attempt", attemptId, {
    error: lastError,
  });
}
