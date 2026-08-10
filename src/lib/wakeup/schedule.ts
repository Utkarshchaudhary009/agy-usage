import type { ScheduleMode, WakeupConfig } from "@/lib/types/wakeup";
import { WAKEUP_LIMITS } from "@/lib/types/wakeup";

const CRON_FIELD_BOUNDS: ReadonlyArray<[number, number]> = [
  [0, 59], // minute
  [0, 23], // hour
  [1, 31], // day of month
  [1, 12], // month
  [0, 6], // day of week (0 = Sunday)
];

const MINUTE_MS = 60 * 1000;
const PREVIEW_HORIZON_DAYS = 366;

export interface CronValidationResult {
  valid: boolean;
  error?: string;
}

/**
 * A cron expression expanded into the concrete set of values each field
 * accepts: [minute, hour, day-of-month, month, day-of-week].
 *
 * Expanding once up front keeps `nextCronTrigger` free of per-candidate regex
 * work, which matters because the preview is computed during render.
 */
type CompiledCron = readonly [
  Set<number>,
  Set<number>,
  Set<number>,
  Set<number>,
  Set<number>,
];

interface CronCompileResult {
  cron?: CompiledCron;
  error?: string;
}

/**
 * Expands a single cron token — wildcard, literal (`5`), range (`1-4`) or any
 * of those with a step suffix (`2-10/2`) — into `out`.
 * Returns an error message when the token is malformed or out of bounds.
 */
function collectTokenValues(
  token: string,
  min: number,
  max: number,
  out: Set<number>,
): string | null {
  const stepMatch = token.match(/^(\*|\d+(?:-\d+)?)\/(\d+)$/);
  if (stepMatch) {
    const step = Number(stepMatch[2]);
    if (step < 1) {
      return `Invalid step in "${token}".`;
    }

    let lo = min;
    let hi = max;
    if (stepMatch[1] !== "*") {
      const bounds = stepMatch[1].split("-");
      lo = Number(bounds[0]);
      // `5/10` is shorthand for `5-<max>/10`, matching standard cron.
      hi = bounds.length > 1 ? Number(bounds[1]) : max;
    }
    if (lo < min || hi > max || lo > hi) {
      return `Range out of bounds in "${token}".`;
    }

    for (let value = lo; value <= hi; value += step) {
      out.add(value);
    }
    return null;
  }

  const rangeMatch = token.match(/^(\*|\d+)(?:-(\d+))?$/);
  if (rangeMatch) {
    const isWildcard = rangeMatch[1] === "*";
    const lo = isWildcard ? min : Number(rangeMatch[1]);
    const hi =
      rangeMatch[2] !== undefined
        ? Number(rangeMatch[2])
        : isWildcard
          ? max
          : lo;
    if (lo < min || hi > max || lo > hi) {
      return `Value out of bounds in "${token}".`;
    }

    for (let value = lo; value <= hi; value++) {
      out.add(value);
    }
    return null;
  }

  return `Unsupported cron token "${token}".`;
}

function compileCron(expression: string): CronCompileResult {
  const parts = expression.trim().split(/\s+/);

  if (parts.length !== 5) {
    return { error: "Cron must have 5 fields (m h dom mon dow)." };
  }

  const fields: Set<number>[] = [];
  for (let field = 0; field < parts.length; field++) {
    const [min, max] = CRON_FIELD_BOUNDS[field];
    const values = new Set<number>();

    for (const token of parts[field].split(",")) {
      const error = collectTokenValues(token, min, max, values);
      if (error) return { error };
    }

    if (values.size === 0) {
      return { error: `Cron field "${parts[field]}" matches nothing.` };
    }
    fields.push(values);
  }

  return { cron: fields as unknown as CompiledCron };
}

/**
 * Validates a standard 5-field cron expression
 * (minute hour day-of-month month day-of-week).
 * Supports wildcards, step values (`base/step`), ranges `a-b`, lists `a,b`,
 * and literal numbers.
 */
export function validateCron(expression: string): CronValidationResult {
  const { error } = compileCron(expression);
  return error ? { valid: false, error } : { valid: true };
}

/**
 * Computes the next scheduled trigger time for a wakeup config, or null if the
 * schedule cannot be resolved. Used to preview "next trigger" in the UI.
 */
export function nextTriggerPreview(
  config: Pick<
    WakeupConfig,
    "scheduleMode" | "intervalHours" | "dailyTimes" | "cronExpression"
  >,
  from: Date = new Date(),
): Date | null {
  switch (config.scheduleMode) {
    case "interval": {
      const hours = Math.max(
        WAKEUP_LIMITS.intervalHours.min,
        config.intervalHours,
      );
      return new Date(from.getTime() + hours * 60 * MINUTE_MS);
    }
    case "daily": {
      return nextDailyTrigger(config.dailyTimes, from);
    }
    case "custom": {
      if (!config.cronExpression) return null;
      const { cron } = compileCron(config.cronExpression);
      if (!cron) return null;
      return nextCronTrigger(cron, from);
    }
    default:
      return null;
  }
}

function nextDailyTrigger(times: string[], from: Date): Date | null {
  const minutesOfDay = new Set<number>();
  for (const time of times) {
    const match = time.match(/^(\d{1,2}):(\d{2})$/);
    if (!match) continue;
    const hour = Number(match[1]);
    const minute = Number(match[2]);
    if (hour > 23 || minute > 59) continue;
    minutesOfDay.add(hour * 60 + minute);
  }

  if (minutesOfDay.size === 0) return null;

  const sorted = [...minutesOfDay].sort((a, b) => a - b);
  const currentMinute = from.getHours() * 60 + from.getMinutes();
  // Strictly in the future, so a time matching the current minute rolls over.
  const upcoming = sorted.find((minute) => minute > currentMinute);

  const candidate = new Date(from.getTime());
  if (upcoming === undefined) {
    candidate.setDate(candidate.getDate() + 1);
  }
  const target = upcoming ?? sorted[0];
  candidate.setHours(Math.floor(target / 60), target % 60, 0, 0);
  return candidate;
}

/**
 * Finds the first minute at or after `from` that satisfies the expression.
 *
 * Walks calendar-component-wise rather than minute-by-minute: a non-matching
 * month/day/hour skips the whole month/day/hour instead of the 40k+ individual
 * minutes it contains. This keeps even never-matching expressions
 * (e.g. `0 0 30 2 *`) to a few hundred iterations.
 *
 * Note: day-of-month and day-of-week are ANDed. Vixie cron ORs them when both
 * are restricted; this implementation intentionally keeps the stricter rule so
 * the preview never claims a trigger the scheduler would not run.
 */
function nextCronTrigger(cron: CompiledCron, from: Date): Date | null {
  const [minutes, hours, daysOfMonth, months, daysOfWeek] = cron;

  const limit = from.getTime() + PREVIEW_HORIZON_DAYS * 24 * 60 * MINUTE_MS;
  const cursor = new Date(from.getTime());
  cursor.setSeconds(0, 0);
  cursor.setMinutes(cursor.getMinutes() + 1);

  while (cursor.getTime() <= limit) {
    if (!months.has(cursor.getMonth() + 1)) {
      cursor.setMonth(cursor.getMonth() + 1, 1);
      cursor.setHours(0, 0, 0, 0);
      continue;
    }
    if (
      !daysOfMonth.has(cursor.getDate()) ||
      !daysOfWeek.has(cursor.getDay())
    ) {
      cursor.setDate(cursor.getDate() + 1);
      cursor.setHours(0, 0, 0, 0);
      continue;
    }
    if (!hours.has(cursor.getHours())) {
      cursor.setHours(cursor.getHours() + 1, 0, 0, 0);
      continue;
    }
    if (!minutes.has(cursor.getMinutes())) {
      cursor.setMinutes(cursor.getMinutes() + 1, 0, 0);
      continue;
    }
    return cursor;
  }

  return null;
}

export function describeSchedule(
  config: Pick<
    WakeupConfig,
    "scheduleMode" | "intervalHours" | "dailyTimes" | "cronExpression"
  >,
): string {
  switch (config.scheduleMode) {
    case "interval":
      return `Every ${config.intervalHours} hour${config.intervalHours === 1 ? "" : "s"}`;
    case "daily":
      return `Daily at ${config.dailyTimes.join(", ") || "(none set)"}`;
    case "custom":
      return config.cronExpression
        ? `Cron: ${config.cronExpression}`
        : "Custom (no expression)";
    default:
      return "Unknown";
  }
}

export type { ScheduleMode };
