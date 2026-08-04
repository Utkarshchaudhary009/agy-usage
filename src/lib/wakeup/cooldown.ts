import "server-only";

/**
 * Returns whether the last wakeup trigger is still within its cooldown window.
 *
 * @param lastTriggeredAt ISO timestamp of the last trigger, or `null` if never triggered.
 * @param cooldownMs Cooldown duration in milliseconds.
 * @returns `true` while the cooldown window is still active, otherwise `false`.
 */
export function isInCooldown(
  lastTriggeredAt: string | null,
  cooldownMs: number,
): boolean {
  if (lastTriggeredAt === null) return false;

  const elapsedMs = Date.now() - new Date(lastTriggeredAt).getTime();
  return elapsedMs < cooldownMs;
}

/**
 * Returns the time left before the cooldown window expires.
 *
 * @param lastTriggeredAt ISO timestamp of the last trigger, or `null` if never triggered.
 * @param cooldownMs Cooldown duration in milliseconds.
 * @returns Remaining cooldown in milliseconds, clamped to `0` (never negative).
 */
export function remainingCooldownMs(
  lastTriggeredAt: string | null,
  cooldownMs: number,
): number {
  if (lastTriggeredAt === null) return 0;

  const elapsedMs = Date.now() - new Date(lastTriggeredAt).getTime();
  return Math.max(0, cooldownMs - elapsedMs);
}
