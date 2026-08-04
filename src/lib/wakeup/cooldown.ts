import "server-only";

/**
 * Returns true when the last trigger happened less than `cooldownMs` ago.
 *
 * A `null` `lastTriggeredAt` means the wakeup has never been triggered, so it
 * is never on cooldown.
 */
export function isInCooldown(
  lastTriggeredAt: string | null,
  cooldownMs: number,
): boolean {
  if (lastTriggeredAt === null) {
    return false;
  }

  const elapsedMs = Date.now() - new Date(lastTriggeredAt).getTime();

  return elapsedMs < cooldownMs;
}

/**
 * Returns how much of the cooldown window is left, in milliseconds.
 *
 * Returns 0 when the wakeup has never been triggered or the cooldown window
 * has already elapsed.
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
