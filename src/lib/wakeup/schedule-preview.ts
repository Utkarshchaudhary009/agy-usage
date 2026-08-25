import type { WakeupConfig } from "@/lib/types/wakeup";
import { nextCronRun, parseCronExpression } from "./cron";

/**
 * Earliest future trigger for a config, or null when it cannot be determined.
 * Interval mode anchors on the last known trigger; without one the schedule is
 * only describable relative to "now" so null is returned.
 *
 * Pure and timezone-consistent with its inputs: callers pass `now` explicitly
 * so server code and client previews evaluate the same instant.
 */
export function computeNextTriggerAt(
  config: WakeupConfig,
  lastTriggerAt: Date | null,
  now: Date,
): Date | null {
  if (!config.enabled) return null;

  switch (config.scheduleMode) {
    case "interval": {
      if (!lastTriggerAt) return null;
      const intervalMs = config.intervalHours * 60 * 60 * 1000;
      // Defensive: validation clamps intervalHours to >= 1, but this helper
      // is also called with client-side draft state.
      if (intervalMs <= 0) return null;
      let next = new Date(lastTriggerAt.getTime() + intervalMs);
      // Catch up across multiple missed intervals so a long-offline schedule
      // shows the next upcoming slot rather than a time in the past.
      while (next.getTime() <= now.getTime()) {
        next = new Date(next.getTime() + intervalMs);
      }
      return next;
    }
    case "daily": {
      const times = [...config.dailyTimes].sort();
      for (let dayOffset = 0; dayOffset < 2; dayOffset++) {
        const day = new Date(
          now.getFullYear(),
          now.getMonth(),
          now.getDate() + dayOffset,
        );
        for (const time of times) {
          const [hours, minutes] = parseTimeOfDay(time);
          const candidate = new Date(day);
          candidate.setHours(hours, minutes, 0, 0);
          if (candidate.getTime() > now.getTime()) return candidate;
        }
      }
      return null;
    }
    case "custom": {
      if (!config.cronExpression) return null;
      const parsed = parseCronExpression(config.cronExpression);
      if (!parsed.ok) return null;
      return nextCronRun(parsed.fields, now);
    }
  }
}

function parseTimeOfDay(time: string): [number, number] {
  const [rawHours, rawMinutes] = time.split(":");
  const hours = Number.parseInt(rawHours ?? "0", 10);
  const minutes = Number.parseInt(rawMinutes ?? "0", 10);
  return [hours, minutes];
}
