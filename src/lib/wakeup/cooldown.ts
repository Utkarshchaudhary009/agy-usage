import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { createServerClient, createServiceClient } from "@/lib/supabase/server";
import type { Database } from "@/lib/types/database";

// Used when no wakeup config exists yet so we still honour a sane default. The
// atomic gate in `begin_wakeup` also defaults to this when no row is supplied,
// read server-side from `wakeup_configs`.
const DEFAULT_COOLDOWN_MINUTES = 60;

export interface CooldownStatus {
  onCooldown: boolean;
  cooldownMinutes: number;
  lastTriggerAt: Date | null;
  nextAllowedAt: Date | null;
}

async function getClient(
  asBackgroundJob: boolean,
): Promise<SupabaseClient<Database>> {
  return asBackgroundJob ? createServiceClient() : await createServerClient();
}

/**
 * Milliseconds remaining until the cooldown clears (0 when not on cooldown).
 *
 * Reads the authoritative boundary from `wakeup_cooldown_locks` (stamped
 * atomically by `begin_wakeup`), not from `wakeup_logs`, so concurrent callers
 * never disagree about whether the cooldown is active. The cooldown duration is
 * read server-side from the user's `wakeup_configs` row, so it cannot be
 * bypassed by a caller-supplied value.
 *
 * Propagates RPC errors (instead of silently reporting "not on cooldown") so
 * callers do not mistake an unavailable cooldown state for a cleared one.
 *
 * Defaults to the RLS-scoped server client so reads honour the caller's
 * identity. Pass `asBackgroundJob: true` (e.g. from an Inngest worker) to use
 * the service-role client when no Clerk session is available.
 */
export async function getCooldownRemainingMs(
  clerkUserId: string,
  asBackgroundJob = false,
): Promise<number> {
  const supabase = await getClient(asBackgroundJob);

  const { data, error } = await supabase.rpc(
    "get_wakeup_cooldown_remaining_ms",
    {
      p_clerk_user_id: clerkUserId,
    },
  );

  if (error) {
    console.error("Failed to compute wakeup cooldown", error);
    // Fail open on the read would let a broken cooldown stampede the API; fail
    // closed by surfacing the error so the caller can decide how to respond.
    throw error;
  }

  return typeof data === "number" ? data : 0;
}

/**
 * Atomically checks the cooldown and, if clear, claims the slot so that any
 * concurrent caller observes the new boundary and is held back. Returns `true`
 * when the wakeup may proceed, `false` when it is still on cooldown.
 *
 * This is the only correct gate: the check and the claim happen inside a single
 * Postgres transaction guarded by a per-user advisory lock, so two wakeups for
 * the same user can never both pass. The cooldown duration is read server-side
 * from `wakeup_configs`, so it cannot be bypassed by a caller-supplied value.
 */
export async function beginWakeup(
  clerkUserId: string,
  asBackgroundJob = false,
): Promise<boolean> {
  const supabase = await getClient(asBackgroundJob);

  const { data, error } = await supabase.rpc("begin_wakeup", {
    p_clerk_user_id: clerkUserId,
  });

  if (error) {
    console.error("Failed to acquire wakeup cooldown lock", error);
    // Fail closed: if we cannot verify the cooldown, do not stampede the
    // Cloud Code API.
    return false;
  }

  return data === true;
}

// Reads the configured cooldown duration for a user. Propagates query errors so
// a transient failure is not silently treated as "use the default 60 minutes".
async function readCooldownMinutes(
  supabase: SupabaseClient<Database>,
  clerkUserId: string,
): Promise<number> {
  const { data, error } = await supabase
    .from("wakeup_configs")
    .select("cooldown_minutes")
    .eq("clerk_user_id", clerkUserId)
    .maybeSingle();

  if (error) {
    throw error;
  }

  return data?.cooldown_minutes ?? DEFAULT_COOLDOWN_MINUTES;
}

export async function isOnCooldown(
  clerkUserId: string,
  asBackgroundJob = false,
): Promise<boolean> {
  const supabase = await getClient(asBackgroundJob);
  await readCooldownMinutes(supabase, clerkUserId);
  return (await getCooldownRemainingMs(clerkUserId, asBackgroundJob)) > 0;
}

/**
 * Computes the current cooldown state for a user for display purposes. Reads the
 * authoritative boundary from `wakeup_cooldown_locks`.
 */
export async function getCooldownStatus(
  clerkUserId: string,
  asBackgroundJob = false,
): Promise<CooldownStatus> {
  const supabase = await getClient(asBackgroundJob);

  const cooldownMinutes = await readCooldownMinutes(supabase, clerkUserId);
  const remainingMs = await getCooldownRemainingMs(
    clerkUserId,
    asBackgroundJob,
  );

  const now = Date.now();
  const lastTriggerAt =
    remainingMs > 0
      ? new Date(now - (cooldownMinutes * 60_000 - remainingMs))
      : null;
  const nextAllowedAt = remainingMs > 0 ? new Date(now + remainingMs) : null;

  return {
    onCooldown: remainingMs > 0,
    cooldownMinutes,
    lastTriggerAt,
    nextAllowedAt,
  };
}
