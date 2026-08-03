import "server-only";

/**
 * Pure cooldown helpers for the wakeup trigger engine.
 *
 * These functions contain no I/O: callers are responsible for loading the last
 * trigger timestamp (e.g. from `wakeup_logs`) and the configured cooldown
 * window (e.g. `cooldown_minutes * 60_000`) before calling in.
 */

/**
 * Returns `true` when the last trigger happened less than `cooldownMs` ago.
 *
 * @param lastTriggeredAt ISO-8601 timestamp of the last trigger, or `null` when
 * the user/account has never been triggered.
 * @param cooldownMs Length of the cooldown window in milliseconds.
 * @returns `false` when `lastTriggeredAt` is `null` (never triggered, so never
 * on cooldown).
 */
export function isInCooldown(
  lastTriggeredAt: string | null,
  cooldownMs: number,
): boolean {
  if (lastTriggeredAt === null) {
    return false;
  }

  return Date.now() - new Date(lastTriggeredAt).getTime() < cooldownMs;
}

/**
 * Returns how much of the cooldown window is left, in milliseconds.
 *
 * @param lastTriggeredAt ISO-8601 timestamp of the last trigger, or `null` when
 * the user/account has never been triggered.
 * @param cooldownMs Length of the cooldown window in milliseconds.
 * @returns `0` when `lastTriggeredAt` is `null` or the cooldown has elapsed;
 * never negative.
 */
export function remainingCooldownMs(
  lastTriggeredAt: string | null,
  cooldownMs: number,
): number {
  if (lastTriggeredAt === null) {
    return 0;
  }

  const elapsedMs = Date.now() - new Date(lastTriggeredAt).getTime();

  return Math.max(0, cooldownMs - elapsedMs);
}
