import type { WakeupConfig } from "@/lib/types/wakeup";
import { pluralize } from "@/lib/utils";
import { describeCron, nextCronRun } from "./cron";

// Human-readable summary of when the wakeup will next run, shown live in the
// config UI as the user edits their schedule.
export function describeSchedule(config: WakeupConfig): string {
  if (!config.enabled) return "Disabled — wakeup will not run.";
  switch (config.scheduleMode) {
    case "interval":
      return `Every ${config.intervalHours} ${pluralize("hour", config.intervalHours)}`;
    case "daily":
      return `Daily at ${config.dailyTimes.join(", ") || "—"}`;
    case "custom":
      return config.cronExpression
        ? describeCron(config.cronExpression)
        : "No cron expression set";
    default:
      return "";
  }
}

// Estimates the next trigger timestamp for preview purposes. For `custom` mode
// this resolves the actual next cron match; for interval/daily it is an
// approximate hint (the definitive schedule logic lives in Phase 16).
export function nextTriggerPreview(config: WakeupConfig): Date | null {
  if (!config.enabled) return null;
  if (config.scheduleMode === "custom" && config.cronExpression) {
    return nextCronRun(config.cronExpression);
  }
  if (config.scheduleMode === "interval") {
    return new Date(Date.now() + config.intervalHours * 60 * 60 * 1000);
  }
  return null;
}
