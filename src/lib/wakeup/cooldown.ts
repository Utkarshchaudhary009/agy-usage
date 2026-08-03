import "server-only";

/**
 * Pure cooldown helpers for the wakeup trigger engine.
 *
 * These functions are intentionally free of I/O so they can be reused by the
 * trigger service, the manual trigger API route, and Inngest jobs. Callers are
 * responsible for loading `lastTriggeredAt` (e.g. the most recent `wakeup_logs`
 * entry) and for converting `cooldown_minutes` into milliseconds.
 */

/**
 * Returns whether a wakeup is still within its cooldown window.
 *
 * @param lastTriggeredAt ISO-8601 timestamp of the last trigger, or `null` when
 * the user has never triggered a wakeup.
 * @param cooldownMs Length of the cooldown window in milliseconds.
 * @returns `true` while the cooldown window is still active, otherwise `false`.
 * Always `false` when `lastTriggeredAt` is `null`.
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
 * Returns the time left before the cooldown window expires.
 *
 * @param lastTriggeredAt ISO-8601 timestamp of the last trigger, or `null` when
 * the user has never triggered a wakeup.
 * @param cooldownMs Length of the cooldown window in milliseconds.
 * @returns Remaining milliseconds, clamped at `0`. Always `0` when
 * `lastTriggeredAt` is `null`.
 */
export function remainingCooldownMs(
  lastTriggeredAt: string | null,
  cooldownMs: number,
): number {
  if (lastTriggeredAt === null) {
    return 0;
  }

  return Math.max(
    0,
    cooldownMs - (Date.now() - new Date(lastTriggeredAt).getTime()),
  );
}
