import { validateDailyTime, type WakeupConfig } from "@/lib/types/wakeup";

/**
 * Computes the next scheduled trigger time for a config, or `null` when it
 * cannot be derived (e.g. a custom cron expression, which is evaluated hourly
 * by the Inngest scheduler). Used for the "next trigger" preview in the UI and
 * (with a known last-run time) for the actual schedule check in Phase 16.
 */
export function computeNextTrigger(
  config: WakeupConfig,
  from: Date = new Date(),
): Date | null {
  if (!config.enabled) return null;

  if (config.scheduleMode === "interval") {
    return new Date(from.getTime() + config.intervalHours * 60 * 60 * 1000);
  }

  if (config.scheduleMode === "daily") {
    const candidates = config.dailyTimes
      .map((time) => parseDailyTime(time, from))
      .filter((d): d is Date => d !== null)
      .sort((a, b) => a.getTime() - b.getTime());

    for (const candidate of candidates) {
      if (candidate.getTime() > from.getTime()) {
        return candidate;
      }
    }
    // No remaining times today: roll over to the earliest time tomorrow.
    if (candidates.length > 0) {
      const first = candidates[0];
      const tomorrow = new Date(first);
      tomorrow.setDate(tomorrow.getDate() + 1);
      return tomorrow;
    }
    return null;
  }

  // Custom cron: cannot be computed without a cron evaluator here.
  return null;
}

function parseDailyTime(time: string, from: Date): Date | null {
  if (!validateDailyTime(time)) return null;
  const [hours, minutes] = time.split(":").map(Number);
  const result = new Date(from);
  result.setHours(hours, minutes, 0, 0);
  return result;
}

/**
 * Human-readable summary of a schedule, e.g. "Every 6 hours" or
 * "Daily at 09:00, 15:00, 21:00".
 */
export function describeSchedule(config: WakeupConfig): string {
  if (!config.enabled) return "Disabled";

  switch (config.scheduleMode) {
    case "interval":
      return `Every ${config.intervalHours} hour${config.intervalHours === 1 ? "" : "s"}`;
    case "daily":
      return `Daily at ${config.dailyTimes.join(", ")}`;
    case "custom":
      return `Custom cron: ${config.cronExpression ?? ""}`;
    default:
      return "Unknown schedule";
  }
}
