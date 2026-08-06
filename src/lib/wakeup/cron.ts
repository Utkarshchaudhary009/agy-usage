// Isomorphic module: pure cron parsing/formatting helpers with no secrets or
// server-side dependencies. Shared by API routes, server components, and the
// client-side schedule picker, so it must NOT be marked `server-only`.
import type { ScheduleMode } from "@/lib/types/wakeup";

export interface CronField {
  name: string;
  min: number;
  max: number;
}

// Standard 5-field cron order: minute hour day-of-month month day-of-week.
const FIELDS: CronField[] = [
  { name: "minute", min: 0, max: 59 },
  { name: "hour", min: 0, max: 23 },
  { name: "day of month", min: 1, max: 31 },
  { name: "month", min: 1, max: 12 },
  { name: "day of week", min: 0, max: 7 },
];

export interface CronValidation {
  valid: boolean;
  error?: string;
}

function validateCronField(value: string, field: CronField): string | null {
  if (value === "*") return null;

  for (const part of value.split(",")) {
    // Step syntax: base/step (e.g. */15, 0-30/10).
    const [base, stepRaw] = part.split("/");
    if (stepRaw !== undefined) {
      const step = Number(stepRaw);
      if (!Number.isInteger(step) || step < 1) {
        return `${field.name}: invalid step "${stepRaw}"`;
      }
    }

    const rangeBase = base === "*" ? `${field.min}-${field.max}` : base;
    if (rangeBase.includes("-")) {
      const [lo, hi] = rangeBase.split("-").map(Number);
      if (
        Number.isNaN(lo) ||
        Number.isNaN(hi) ||
        lo < field.min ||
        hi > field.max ||
        lo > hi
      ) {
        return `${field.name}: range ${rangeBase} out of bounds (${field.min}-${field.max})`;
      }
      continue;
    }

    const single = Number(rangeBase);
    // 0 and 7 are both Sunday for day-of-week.
    if (
      Number.isNaN(single) ||
      single < field.min ||
      single > field.max ||
      (field.name === "day of week" && single > 7)
    ) {
      return `${field.name}: "${rangeBase}" out of bounds (${field.min}-${field.max})`;
    }
  }

  return null;
}

export function validateCronExpression(expression: string): CronValidation {
  const trimmed = expression.trim();
  const parts = trimmed.split(/\s+/);

  if (parts.length !== 5) {
    return {
      valid: false,
      error: `Expected 5 fields (minute hour day month weekday), got ${parts.length}.`,
    };
  }

  for (let i = 0; i < FIELDS.length; i++) {
    const err = validateCronField(parts[i], FIELDS[i]);
    if (err) return { valid: false, error: err };
  }

  return { valid: true };
}

// Produces a short, human-readable summary for the most common cron shapes.
// Falls back to echoing the raw expression for anything unusual.
export function describeCron(expression: string): string {
  const [minute, hour, dom, month, dow] = expression.trim().split(/\s+/);

  const isEvery = (v: string) => v === "*";

  // Daily at a fixed time: "30 9 * * *" -> "Daily at 09:30".
  if (isEvery(dom) && isEvery(month) && isEvery(dow)) {
    if (!isEvery(hour) && !isEvery(minute)) {
      return `Daily at ${hour.padStart(2, "0")}:${minute.padStart(2, "0")}`;
    }
  }

  // Every N minutes: "*/15 * * * *".
  if (
    minute.startsWith("*/") &&
    isEvery(hour) &&
    isEvery(dom) &&
    isEvery(month) &&
    isEvery(dow)
  ) {
    return `Every ${minute.slice(2)} minutes`;
  }

  // Every N hours: "0 */6 * * *".
  if (
    isEvery(minute) &&
    hour.startsWith("*/") &&
    isEvery(dom) &&
    isEvery(month) &&
    isEvery(dow)
  ) {
    return `Every ${hour.slice(2)} hours`;
  }

  return `Cron: ${expression.trim()}`;
}

export function scheduleNextPreview(
  mode: ScheduleMode,
  opts: {
    intervalHours?: number;
    dailyTimes?: string[];
    cronExpression?: string | null;
  },
): string {
  if (mode === "interval") {
    const h = opts.intervalHours ?? 6;
    return `Next run about ${h} hour${h === 1 ? "" : "s"} after the last one`;
  }
  if (mode === "daily") {
    const times = (opts.dailyTimes ?? []).filter(Boolean);
    if (times.length === 0) return "No daily times configured";
    return `Daily at ${times
      .slice()
      .sort()
      .map((t) => t.padStart(5, "0"))
      .join(", ")}`;
  }
  if (opts.cronExpression) {
    const v = validateCronExpression(opts.cronExpression);
    return v.valid
      ? describeCron(opts.cronExpression)
      : "Invalid cron expression";
  }
  return "No cron expression configured";
}
