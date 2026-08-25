import type { WakeupConfig } from "@/lib/types/wakeup";
import { nextCronRun, parseCronExpression } from "./cron";

/**
 * How far back from `now` a schedule slot (daily HH:MM or custom-cron minute)
 * may fall and still count as due. The scheduler ticks hourly, so exact-minute
 * matching would silently skip every slot not aligned to the top of the hour;
 * instead a slot fires on the first tick at or after its time.
 */
const SLOT_LOOKBACK_MS = 60 * 60 * 1000;

/**
 * Decides whether a wakeup config's schedule is due at instant `now`.
 *
 * Schedules evaluate against server time (UTC on the deployed runtime) per the
 * Phase 14 review decision; the config UI preview converts to the viewer's
 * browser-local timezone for display only. Callers pass `now` explicitly so
 * every config in one scheduler tick is evaluated against the same instant.
 *
 * - interval: due once `intervalHours` have passed since the last run (a
 *   config that has never run is immediately due, otherwise it could never
 *   fire its first scheduled run).
 * - daily: due on the first tick at or after any HH:MM entry (yesterday's
 *   slots are checked too so late-night times survive the midnight boundary).
 * - custom: due on the first tick at or after any cron slot.
 *
 * Pure function: no I/O, safe for client bundles. Whether a due schedule
 * actually fires is decided later by the atomic cooldown claim.
 */
export function shouldTriggerNow(
  config: Pick<
    WakeupConfig,
    | "enabled"
    | "scheduleMode"
    | "intervalHours"
    | "dailyTimes"
    | "cronExpression"
  >,
  lastTriggerAt: string | Date | null,
  now: Date,
): boolean {
  if (!config.enabled) return false;

  switch (config.scheduleMode) {
    case "interval":
      return isIntervalDue(config.intervalHours, lastTriggerAt, now);
    case "daily":
      return isDailyDue(config.dailyTimes, now);
    case "custom":
      return isCronDue(config.cronExpression, now);
    // Unreachable while schedule_mode carries its DB CHECK constraint;
    // returning false keeps an out-of-band value inert instead of undefined.
    default:
      return false;
  }
}

function isIntervalDue(
  intervalHours: number,
  lastTriggerAt: string | Date | null,
  now: Date,
): boolean {
  if (lastTriggerAt === null) return true;
  const lastMs = Date.parse(String(lastTriggerAt));
  if (Number.isNaN(lastMs)) return true;
  return now.getTime() - lastMs >= intervalHours * 60 * 60 * 1000;
}

/**
 * A daily slot is due when it elapsed within the current tick window. Both
 * today's and yesterday's occurrences are considered so a slot shortly after
 * midnight is caught by the tick that follows it across the day boundary.
 */
function isDailyDue(dailyTimes: string[], now: Date): boolean {
  for (const time of dailyTimes) {
    const [hours, minutes] = parseTimeOfDay(time);
    if (hours === null || minutes === null) continue;
    for (const dayOffset of [0, -1]) {
      const candidate = new Date(now);
      candidate.setDate(candidate.getDate() + dayOffset);
      candidate.setHours(hours, minutes, 0, 0);
      const elapsed = now.getTime() - candidate.getTime();
      if (elapsed >= 0 && elapsed <= SLOT_LOOKBACK_MS) return true;
    }
  }
  return false;
}

function isCronDue(expression: string | null, now: Date): boolean {
  if (!expression) return false;
  const parsed = parseCronExpression(expression);
  if (!parsed.ok) return false;

  const lookbackStart = new Date(now.getTime() - SLOT_LOOKBACK_MS);
  const dueSlot = nextCronRun(parsed.fields, lookbackStart);
  return dueSlot !== null && dueSlot <= now;
}

function parseTimeOfDay(time: string): [number | null, number | null] {
  const match = /^(\d{2}):(\d{2})$/.exec(time.trim());
  if (!match) return [null, null];
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return [null, null];
  return [hours, minutes];
}
