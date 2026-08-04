import "server-only";

export function isInCooldown(
  lastTriggeredAt: string | null,
  cooldownMs: number,
): boolean {
  if (lastTriggeredAt === null) {
    return false;
  }
  return Date.now() - new Date(lastTriggeredAt).getTime() < cooldownMs;
}

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
