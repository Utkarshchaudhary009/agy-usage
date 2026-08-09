import type { ScheduleMode, WakeupConfig } from "@/lib/types/wakeup";
import { parseCron } from "./cron";

const MAX_LOOKAHEAD_DAYS = 366;

/**
 * Hard ceiling on cron search iterations. The skip-ahead logic in
 * `getNextCronTime` stays in the low hundreds even for pathological
 * expressions; this is a backstop against an unforeseen non-advancing cursor
 * (e.g. a DST edge) turning into an infinite loop.
 */
const MAX_CRON_ITERATIONS = 10_000;

/** Strict 24h HH:MM. Rejects values like "99:99" that Date would roll over. */
const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

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
      if (!config.cronExpression) return null;
      return getNextCronTime(config.cronExpression, from);
    default:
      return null;
  }
}

function getNextDailyTime(times: string[], from: Date): Date | null {
  const parsed = times
    .map((t) => TIME_RE.exec(t))
    .filter((m): m is RegExpExecArray => m !== null)
    .map((m) => ({
      h: Number(m[1]),
      m: Number(m[2]),
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
  const cron = parseCron(expr);
  if (!cron) return null;

  const cursor = new Date(from);
  cursor.setSeconds(0, 0);
  cursor.setMinutes(cursor.getMinutes() + 1);

  const limit = cursor.getTime() + MAX_LOOKAHEAD_DAYS * 24 * 60 * 60 * 1000;

  // Skip ahead by the largest unit that cannot match instead of stepping one
  // minute at a time. A valid-but-never-matching expression (e.g. "0 0 30 2 *"
  // — February 30th) previously walked a full year minute by minute: ~527k
  // iterations of date arithmetic. That runs in a `useMemo` on every keystroke
  // in the cron input and is exported for server-side use, so it was a cheap
  // client- and server-side CPU DoS. Skipping keeps it in the low hundreds.
  for (let i = 0; i < MAX_CRON_ITERATIONS; i++) {
    if (cursor.getTime() > limit) return null;

    if (!cron.months.has(cursor.getMonth() + 1)) {
      cursor.setMonth(cursor.getMonth() + 1, 1);
      cursor.setHours(0, 0, 0, 0);
      continue;
    }
    if (
      !cron.daysOfMonth.has(cursor.getDate()) ||
      !cron.daysOfWeek.has(cursor.getDay())
    ) {
      cursor.setDate(cursor.getDate() + 1);
      cursor.setHours(0, 0, 0, 0);
      continue;
    }
    if (!cron.hours.has(cursor.getHours())) {
      cursor.setHours(cursor.getHours() + 1, 0, 0, 0);
      continue;
    }
    if (!cron.minutes.has(cursor.getMinutes())) {
      cursor.setMinutes(cursor.getMinutes() + 1, 0, 0);
      continue;
    }
    return new Date(cursor);
  }

  return null;
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
