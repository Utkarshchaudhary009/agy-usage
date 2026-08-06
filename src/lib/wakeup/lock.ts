import "server-only";

import { createServiceClient } from "@/lib/supabase/server";

// Base lease time granted up front, before we know how much work a run holds.
// `executeWakeup` renews it once it has loaded the account/model fan-out size,
// and always releases it in a `finally` — so this only needs to be long enough
// to cover the config/cooldown/account-load phase.
const WAKEUP_LEASE_BASE_TTL_SEC = 120;

// Per-trigger ceiling, used to size the renewed lease to the real fan-out.
const WAKEUP_PER_TRIGGER_SEC = 35;

// Extra headroom on top of the computed fan-out duration.
const WAKEUP_LEASE_MARGIN_SEC = 30;

export type AcquireWakeupLockResult =
  | { granted: true; lockToken: string }
  | { granted: false };

// Attempts to take the per-user wakeup lease. Returns `granted: false` when
// another execution already holds an unexpired lease for this user — the caller
// should skip rather than double-trigger Google. See migration 010.
export async function acquireWakeupLock(
  clerkUserId: string,
): Promise<AcquireWakeupLockResult> {
  try {
    const supabase = createServiceClient();
    const { data, error } = await supabase.rpc("acquire_wakeup_lock", {
      p_user_id: clerkUserId,
      p_ttl_seconds: WAKEUP_LEASE_BASE_TTL_SEC,
    });

    if (error) {
      console.error("Failed to acquire wakeup lock:", error);
      // On a lease-system failure, refuse to run rather than risk a duplicate
      // trigger racing an in-flight execution we cannot see.
      return { granted: false };
    }

    const outcome = (data as { outcome?: string } | null)?.outcome;
    if (outcome !== "granted") return { granted: false };

    const lockToken = (data as { lock_token?: string }).lock_token;
    if (!lockToken) return { granted: false };

    return { granted: true, lockToken };
  } catch (err) {
    console.error("Failed to acquire wakeup lock:", err);
    return { granted: false };
  }
}

// Extends an owned lease to cover the actual account x model fan-out. Returns
// false if the lease has already expired or been re-granted elsewhere, in which
// case the caller must stop triggering.
export async function renewWakeupLock(
  clerkUserId: string,
  lockToken: string,
  ttlSeconds: number,
): Promise<boolean> {
  try {
    const supabase = createServiceClient();
    const { data, error } = await supabase.rpc("renew_wakeup_lock", {
      p_user_id: clerkUserId,
      p_lock_token: lockToken,
      p_ttl_seconds: ttlSeconds,
    });

    if (error) {
      console.error("Failed to renew wakeup lock:", error);
      return false;
    }

    return data === true;
  } catch (err) {
    console.error("Failed to renew wakeup lock:", err);
    return false;
  }
}

// Releases a lease held by this execution. Swallows errors: a failed release is
// harmless because the lease is TTL-bounded and will be reaped.
export async function releaseWakeupLock(
  clerkUserId: string,
  lockToken: string,
): Promise<void> {
  try {
    const supabase = createServiceClient();
    const { error } = await supabase.rpc("release_wakeup_lock", {
      p_user_id: clerkUserId,
      p_lock_token: lockToken,
    });

    if (error) {
      console.error("Failed to release wakeup lock:", error);
    }
  } catch (err) {
    console.error("Failed to release wakeup lock:", err);
  }
}

// Sizes the renewed lease to the real amount of work: one ceiling per
// (account, model) trigger plus a fixed margin.
export function estimateWakeupLeaseSeconds(
  accountCount: number,
  modelCount: number,
): number {
  return (
    accountCount * modelCount * WAKEUP_PER_TRIGGER_SEC + WAKEUP_LEASE_MARGIN_SEC
  );
}
