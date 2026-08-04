/**
 * Date formatting helpers for the wakeup UI.
 *
 * `formatUtcDateTime` is deterministic (never locale/timezone dependent), so
 * it is safe to render during SSR and hydration; local-time rendering only
 * happens after mount.
 */

/** Formats as `2026-08-04 18:00 UTC`. */
export function formatUtcDateTime(date: Date): string {
  return `${date.toISOString().slice(0, 16).replace("T", " ")} UTC`;
}

/** Formats the gap between two timestamps as `in 3h 20m`. */
export function formatRelativeTime(fromMs: number, toMs: number): string {
  const totalMinutes = Math.max(0, Math.round((toMs - fromMs) / 60_000));
  if (totalMinutes < 1) return "in less than a minute";
  if (totalMinutes < 60) return `in ${totalMinutes}m`;

  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours < 24) {
    return minutes === 0 ? `in ${hours}h` : `in ${hours}h ${minutes}m`;
  }

  const days = Math.floor(hours / 24);
  const remainingHours = hours % 24;
  return remainingHours === 0
    ? `in ${days}d`
    : `in ${days}d ${remainingHours}h`;
}
