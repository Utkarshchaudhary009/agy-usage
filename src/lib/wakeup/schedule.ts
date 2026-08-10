import type { ScheduleMode, WakeupConfig } from "@/lib/types/wakeup";

const CRON_FIELD_BOUNDS: ReadonlyArray<[number, number]> = [
  [0, 59], // minute
  [0, 23], // hour
  [1, 31], // day of month
  [1, 12], // month
  [0, 6], // day of week (0 = Sunday)
];

export interface CronValidationResult {
  valid: boolean;
  error?: string;
}

/**
 * Validates a standard 5-field cron expression
 * (minute hour day-of-month month day-of-week).
 * Supports wildcards, step values (`base/step`), ranges `a-b`, lists `a,b`,
 * and literal numbers.
 */
export function validateCron(expression: string): CronValidationResult {
  const trimmed = expression.trim();
  const parts = trimmed.split(/\s+/);

  if (parts.length !== 5) {
    return {
      valid: false,
      error: "Cron must have 5 fields (m h dom mon dow).",
    };
  }

  for (let field = 0; field < parts.length; field++) {
    const value = parts[field];
    const [min, max] = CRON_FIELD_BOUNDS[field];

    for (const token of value.split(",")) {
      const stepMatch = token.match(/^(\*|\d+(?:-\d+)?)\/(\d+)$/);
      if (stepMatch) {
        const step = Number(stepMatch[2]);
        if (step < 1) {
          return { valid: false, error: `Invalid step in "${token}".` };
        }
        if (stepMatch[1] !== "*") {
          const [lo, hi] = stepMatch[1].split("-").map(Number);
          if (lo < min || hi > max || lo > hi) {
            return {
              valid: false,
              error: `Range out of bounds in "${token}".`,
            };
          }
        }
        continue;
      }

      const rangeMatch = token.match(/^(\*|\d+)(?:-(\d+))?$/);
      if (rangeMatch) {
        const lo = rangeMatch[1] === "*" ? min : Number(rangeMatch[1]);
        const hi =
          rangeMatch[2] === undefined
            ? rangeMatch[1] === "*"
              ? max
              : Number(rangeMatch[1])
            : Number(rangeMatch[2]);
        if (lo < min || hi > max || lo > hi) {
          return { valid: false, error: `Value out of bounds in "${token}".` };
        }
        continue;
      }

      return { valid: false, error: `Unsupported cron token "${token}".` };
    }
  }

  return { valid: true };
}

function cronMatches(cronParts: string[], date: Date): boolean {
  const fields = [
    date.getMinutes(),
    date.getHours(),
    date.getDate(),
    date.getMonth() + 1,
    date.getDay(),
  ];

  for (let field = 0; field < 5; field++) {
    const [min, max] = CRON_FIELD_BOUNDS[field];
    const matched = cronParts[field]
      .split(",")
      .some((token) => fieldMatches(token, fields[field], min, max));
    if (!matched) return false;
  }
  return true;
}

function fieldMatches(
  token: string,
  value: number,
  min: number,
  max: number,
): boolean {
  if (token === "*") return true;
  const stepMatch = token.match(/^(\*|\d+(?:-\d+)?)\/(\d+)$/);
  if (stepMatch) {
    const step = Number(stepMatch[2]);
    if (stepMatch[1] === "*") {
      return value >= min && value <= max && (value - min) % step === 0;
    }
    const [lo, hi] = stepMatch[1].split("-").map(Number);
    return value >= lo && value <= hi && (value - lo) % step === 0;
  }
  const rangeMatch = token.match(/^(\d+)(?:-(\d+))?$/);
  if (rangeMatch) {
    const lo = Number(rangeMatch[1]);
    const hi = rangeMatch[2] === undefined ? lo : Number(rangeMatch[2]);
    return value >= lo && value <= hi;
  }
  return false;
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
      const hours = Math.max(1, config.intervalHours);
      return new Date(from.getTime() + hours * 60 * 60 * 1000);
    }
    case "daily": {
      return nextDailyTrigger(config.dailyTimes, from);
    }
    case "custom": {
      if (!config.cronExpression) return null;
      const parts = config.cronExpression.trim().split(/\s+/);
      if (parts.length !== 5) return null;
      return nextCronTrigger(parts, from);
    }
    default:
      return null;
  }
}

function nextDailyTrigger(times: string[], from: Date): Date | null {
  const parsed = times
    .map((t) => {
      const m = t.match(/^(\d{1,2}):(\d{2})$/);
      if (!m) return null;
      const hour = Number(m[1]);
      const minute = Number(m[2]);
      if (hour > 23 || minute > 59) return null;
      return { hour, minute };
    })
    .filter((t): t is { hour: number; minute: number } => t !== null)
    .sort((a, b) => a.hour * 60 + a.minute - (b.hour * 60 + b.minute));

  if (parsed.length === 0) return null;

  for (let offset = 0; offset <= 24 * 60; offset++) {
    const candidate = new Date(from.getTime() + offset * 60 * 1000);
    const matches = parsed.find(
      (t) =>
        t.hour === candidate.getHours() && t.minute === candidate.getMinutes(),
    );
    if (matches && offset > 0) return candidate;
  }
  return null;
}

function nextCronTrigger(parts: string[], from: Date): Date | null {
  // Walk forward minute-by-minute up to a year out (sufficient for previews).
  const limit = from.getTime() + 366 * 24 * 60 * 60 * 1000;
  const cursor = new Date(from.getTime() + 60 * 1000);
  cursor.setSeconds(0, 0);

  while (cursor.getTime() <= limit) {
    if (cronMatches(parts, cursor)) return cursor;
    cursor.setMinutes(cursor.getMinutes() + 1);
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
