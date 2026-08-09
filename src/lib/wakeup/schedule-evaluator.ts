import type { ScheduleMode, WakeupConfig } from "@/lib/types/wakeup";
import { isValidCron } from "./cron";

const MAX_LOOKAHEAD_DAYS = 366;

interface CronField {
  min: number;
  max: number;
  /** Maps a 0-7 dow value so both 0 and 7 mean Sunday. */
  normalize?: (value: number) => number;
}

const FIELDS: CronField[] = [
  { min: 0, max: 59 }, // minute
  { min: 0, max: 23 }, // hour
  { min: 1, max: 31 }, // day of month
  { min: 1, max: 12 }, // month
  { min: 0, max: 7, normalize: (v) => (v === 7 ? 0 : v) }, // day of week
];

/**
 * Computes the next time a wakeup should fire given the config. Returns `null`
 * when the schedule can't be resolved (e.g. an invalid custom cron).
 */
export function getNextTriggerTime(
  config: WakeupConfig,
  from: Date = new Date(),
): Date | null {
  switch (config.scheduleMode) {
    case "interval":
      return new Date(from.getTime() + config.intervalHours * 60 * 60 * 1000);
    case "daily":
      return getNextDailyTime(config.dailyTimes, from);
    case "custom":
      if (!config.cronExpression || !isValidCron(config.cronExpression)) {
        return null;
      }
      return getNextCronTime(config.cronExpression, from);
    default:
      return null;
  }
}

function getNextDailyTime(times: string[], from: Date): Date | null {
  const parsed = times
    .map((t) => /^(\d{2}):(\d{2})$/.exec(t))
    .filter((m): m is RegExpExecArray => m !== null)
    .map((m) => ({
      h: Number.parseInt(m[1], 10),
      m: Number.parseInt(m[2], 10),
    }))
    .sort((a, b) => a.h - b.h || a.m - b.m);

  if (parsed.length === 0) return null;

  const start = new Date(from);
  start.setSeconds(0, 0);

  let best: Date | null = null;
  for (let dayOffset = 0; dayOffset <= 7; dayOffset++) {
    for (const { h, m } of parsed) {
      const candidate = new Date(start);
      candidate.setDate(candidate.getDate() + dayOffset);
      candidate.setHours(h, m, 0, 0);
      if (candidate.getTime() <= from.getTime()) continue;
      if (best === null || candidate.getTime() < best.getTime()) {
        best = candidate;
      }
    }
    if (best && dayOffset > 0) break;
  }
  return best;
}

function getNextCronTime(expr: string, from: Date): Date | null {
  const parts = expr.trim().split(/\s+/);
  const sets = parts.map((part, i) => expandField(part, FIELDS[i]));
  if (sets.some((s) => s === null)) return null;

  const start = new Date(from);
  start.setSeconds(0, 0);

  const cursor = new Date(start);
  cursor.setMinutes(cursor.getMinutes() + 1, 0, 0);

  const [minuteSet, hourSet, domSet, monthSet, dowSet] = sets as Set<number>[];

  const limit = cursor.getTime() + MAX_LOOKAHEAD_DAYS * 24 * 60 * 60 * 1000;
  while (cursor.getTime() <= limit) {
    const minute = cursor.getMinutes();
    const hour = cursor.getHours();
    const dom = cursor.getDate();
    const month = cursor.getMonth() + 1;
    const dow = cursor.getDay();

    if (
      minuteSet.has(minute) &&
      hourSet.has(hour) &&
      domSet.has(dom) &&
      monthSet.has(month) &&
      dowSet.has(dow)
    ) {
      return new Date(cursor);
    }
    cursor.setMinutes(cursor.getMinutes() + 1, 0, 0);
  }
  return null;
}

function expandField(part: string, field: CronField): Set<number> | null {
  const result = new Set<number>();
  const stepParts = part.split("/");
  if (stepParts.length > 2) return null;
  const range = stepParts[0];
  const step = stepParts[1] ? Number.parseInt(stepParts[1], 10) : 1;
  if (!step || step < 1) return null;

  const addRange = (lo: number, hi: number) => {
    if (lo < field.min || hi > field.max || lo > hi) return false;
    for (let v = lo; v <= hi; v += step) {
      result.add(field.normalize ? field.normalize(v) : v);
    }
    return true;
  };

  if (range === "*") {
    return addRange(field.min, field.max) ? result : null;
  }

  for (const token of range.split(",")) {
    if (token.includes("-")) {
      const [loStr, hiStr] = token.split("-");
      const lo = Number.parseInt(loStr, 10);
      const hi = Number.parseInt(hiStr, 10);
      if (Number.isNaN(lo) || Number.isNaN(hi)) return null;
      if (!addRange(lo, hi)) return null;
    } else {
      const value = Number.parseInt(token, 10);
      if (Number.isNaN(value)) return null;
      if (value < field.min || value > field.max) return null;
      result.add(field.normalize ? field.normalize(value) : value);
    }
  }
  return result.size > 0 ? result : null;
}

/** Human-readable summary of a schedule, e.g. "Every 6 hours". */
export function describeSchedule(
  mode: ScheduleMode,
  config: Pick<WakeupConfig, "intervalHours" | "dailyTimes" | "cronExpression">,
): string {
  switch (mode) {
    case "interval":
      return config.intervalHours === 1
        ? "Every hour"
        : `Every ${config.intervalHours} hours`;
    case "daily": {
      const times = [...config.dailyTimes].sort();
      if (times.length === 0) return "No daily times set";
      if (times.length <= 3) return `Daily at ${times.join(", ")}`;
      return `Daily at ${times.slice(0, 3).join(", ")} (+${times.length - 3} more)`;
    }
    case "custom":
      return config.cronExpression
        ? `Custom cron: ${config.cronExpression}`
        : "Custom cron (unset)";
    default:
      return "";
  }
}

export function formatNextTrigger(date: Date | null): string {
  if (!date) return "—";
  return date.toLocaleString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}
