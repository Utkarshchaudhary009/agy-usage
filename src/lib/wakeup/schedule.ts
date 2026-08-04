/**
 * Schedule evaluation shared by the config UI preview and (from Phase 16) the
 * scheduled job runner.
 *
 * Everything is evaluated in **UTC**:
 * - `interval` fires at fixed slots anchored to the Unix epoch, so the cadence
 *   is uniform and does not drift each time the config is saved. Intervals
 *   that divide 24 land on the familiar UTC times (every 6 hours means 00:00,
 *   06:00, 12:00, 18:00 UTC).
 * - `daily` fires at the configured `HH:MM` UTC times.
 * - `custom` follows the cron expression.
 *
 * Pure module: safe to import from both server and client code.
 */

import type { WakeupConfigInput } from "@/lib/types/wakeup";
import {
  describeCronExpression,
  getNextCronRun,
  parseCronExpression,
} from "./cron";

const MS_PER_MINUTE = 60_000;
const MS_PER_HOUR = 60 * MS_PER_MINUTE;
const MS_PER_DAY = 24 * MS_PER_HOUR;

const TIME_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/;

/** Validates an `HH:MM` (24-hour, zero-padded) time string. */
export function isValidDailyTime(value: string): boolean {
  return TIME_PATTERN.test(value);
}

/** Converts `HH:MM` into minutes past midnight, or null when malformed. */
export function parseDailyTime(value: string): number | null {
  const match = TIME_PATTERN.exec(value);
  if (!match) return null;
  return Number.parseInt(match[1], 10) * 60 + Number.parseInt(match[2], 10);
}

function nextIntervalRun(intervalHours: number, from: Date): Date | null {
  if (!Number.isFinite(intervalHours) || intervalHours <= 0) return null;

  const intervalMs = intervalHours * MS_PER_HOUR;

  // Anchored to the Unix epoch (00:00 UTC) rather than to each day's midnight,
  // so the cadence is uniform even when the interval does not divide 24 (an
  // interval of 5h would otherwise produce a short 4h gap at every midnight).
  // For divisors of 24 this still lands on 00:00 UTC and multiples thereof.
  const slot = Math.floor(from.getTime() / intervalMs) + 1;

  return new Date(slot * intervalMs);
}

function nextDailyRun(dailyTimes: string[], from: Date): Date | null {
  const minutes = dailyTimes
    .map(parseDailyTime)
    .filter((value): value is number => value !== null)
    .sort((a, b) => a - b);

  if (minutes.length === 0) return null;

  const startOfDay = Date.UTC(
    from.getUTCFullYear(),
    from.getUTCMonth(),
    from.getUTCDate(),
  );

  for (const minute of minutes) {
    const candidate = startOfDay + minute * MS_PER_MINUTE;
    if (candidate > from.getTime()) return new Date(candidate);
  }

  // Every time today has passed, so use the earliest slot tomorrow.
  return new Date(startOfDay + MS_PER_DAY + minutes[0] * MS_PER_MINUTE);
}

/**
 * Computes the next UTC trigger time strictly after `from`.
 *
 * Returns null when the schedule is disabled, has no target accounts/models,
 * or is not evaluable (invalid cron, no daily times, unreachable date).
 */
export function getNextTriggerAt(
  config: WakeupConfigInput,
  from: Date = new Date(),
): Date | null {
  if (!config.enabled) return null;
  if (config.selectedModels.length === 0) return null;
  if (config.selectedAccountIds.length === 0) return null;
  if (Number.isNaN(from.getTime())) return null;

  switch (config.scheduleMode) {
    case "interval":
      return nextIntervalRun(config.intervalHours, from);
    case "daily":
      return nextDailyRun(config.dailyTimes, from);
    case "custom": {
      if (!config.cronExpression) return null;
      const result = parseCronExpression(config.cronExpression);
      if (!result.ok) return null;
      return getNextCronRun(result.schedule, from);
    }
    default:
      return null;
  }
}

/** Human-readable summary of the schedule, independent of the enabled flag. */
export function describeSchedule(config: WakeupConfigInput): string {
  switch (config.scheduleMode) {
    case "interval":
      return config.intervalHours === 1
        ? "Every hour (UTC)"
        : `Every ${config.intervalHours} hours (UTC)`;
    case "daily": {
      const times = config.dailyTimes.filter(isValidDailyTime);
      if (times.length === 0) return "No times selected";
      return `Daily at ${[...times].sort().join(", ")} (UTC)`;
    }
    case "custom":
      if (!config.cronExpression) return "No cron expression set";
      return describeCronExpression(config.cronExpression);
    default:
      return "Unknown schedule";
  }
}
