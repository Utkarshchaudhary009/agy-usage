/**
 * Minimal 5-field cron parser used for custom wakeup schedules.
 *
 * Supported syntax: `minute hour day-of-month month day-of-week` with
 * wildcards, lists (`1,2`), ranges (`1-5`), step values (such as every 15
 * minutes, written as a wildcard followed by a slash and the step) and the
 * usual three-letter month/weekday names.
 *
 * All evaluation happens in **UTC** so the client-side preview and the
 * server-side scheduler always agree. Pure module: safe to import from both
 * server and client code.
 */

import { WAKEUP_LIMITS } from "@/lib/types/wakeup";

export interface CronSchedule {
  minutes: number[];
  hours: number[];
  daysOfMonth: number[];
  months: number[];
  daysOfWeek: number[];
  /** Standard cron ORs day-of-month with day-of-week when both are restricted. */
  restrictedDayOfMonth: boolean;
  restrictedDayOfWeek: boolean;
}

export type CronParseResult =
  | { ok: true; schedule: CronSchedule }
  | { ok: false; error: string };

interface FieldSpec {
  name: string;
  min: number;
  max: number;
  names?: Record<string, number>;
}

const MONTH_NAMES: Record<string, number> = {
  jan: 1,
  feb: 2,
  mar: 3,
  apr: 4,
  may: 5,
  jun: 6,
  jul: 7,
  aug: 8,
  sep: 9,
  oct: 10,
  nov: 11,
  dec: 12,
};

const DAY_NAMES: Record<string, number> = {
  sun: 0,
  mon: 1,
  tue: 2,
  wed: 3,
  thu: 4,
  fri: 5,
  sat: 6,
};

const FIELD_SPECS: FieldSpec[] = [
  { name: "minute", min: 0, max: 59 },
  { name: "hour", min: 0, max: 23 },
  { name: "day-of-month", min: 1, max: 31 },
  { name: "month", min: 1, max: 12, names: MONTH_NAMES },
  // 7 is accepted as an alias for Sunday and normalised to 0.
  { name: "day-of-week", min: 0, max: 7, names: DAY_NAMES },
];

const WEEKDAY_LABELS = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];

const MONTH_LABELS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

/** How far ahead `getNextCronRun` looks before giving up. Five years so that
 * genuinely sparse schedules (`0 0 29 2 *` - Feb 29) still resolve. */
const MAX_LOOKAHEAD_DAYS = 1830;

function parseValue(token: string, spec: FieldSpec): number | null {
  const named = spec.names?.[token.toLowerCase()];
  if (named !== undefined) return named;

  // Reject "+5", "5.0", "" and other loosely-numeric tokens.
  if (!/^\d+$/.test(token)) return null;

  const value = Number.parseInt(token, 10);
  if (value < spec.min || value > spec.max) return null;
  return value;
}

function parseField(field: string, spec: FieldSpec): number[] | string {
  const values = new Set<number>();

  for (const part of field.split(",")) {
    if (part === "") {
      return `Invalid ${spec.name} field: empty list entry.`;
    }

    const [rangePart, stepPart, ...extra] = part.split("/");
    if (extra.length > 0) {
      return `Invalid ${spec.name} field: "${part}" has more than one step.`;
    }

    let step = 1;
    if (stepPart !== undefined) {
      if (!/^\d+$/.test(stepPart)) {
        return `Invalid ${spec.name} step: "${stepPart}" is not a number.`;
      }
      step = Number.parseInt(stepPart, 10);
      if (step < 1) {
        return `Invalid ${spec.name} step: must be 1 or greater.`;
      }
    }

    let start: number;
    let end: number;

    if (rangePart === "*") {
      start = spec.min;
      end = spec.max;
    } else if (rangePart.includes("-")) {
      const [fromToken, toToken, ...rest] = rangePart.split("-");
      if (rest.length > 0) {
        return `Invalid ${spec.name} range: "${rangePart}".`;
      }
      const from = parseValue(fromToken, spec);
      const to = parseValue(toToken, spec);
      if (from === null || to === null) {
        return `Invalid ${spec.name} range: "${rangePart}".`;
      }
      if (from > to) {
        return `Invalid ${spec.name} range: "${rangePart}" starts after it ends.`;
      }
      start = from;
      end = to;
    } else {
      const value = parseValue(rangePart, spec);
      if (value === null) {
        return `Invalid ${spec.name} value: "${rangePart}" (expected ${spec.min}-${spec.max}).`;
      }
      // A bare value with a step means "from this value to the maximum".
      start = value;
      end = stepPart === undefined ? value : spec.max;
    }

    for (let value = start; value <= end; value += step) {
      // Day-of-week 7 and 0 both mean Sunday.
      values.add(spec.name === "day-of-week" && value === 7 ? 0 : value);
    }
  }

  if (values.size === 0) {
    return `Invalid ${spec.name} field: no values matched.`;
  }

  return [...values].sort((a, b) => a - b);
}

/** Parses and validates a 5-field cron expression. */
export function parseCronExpression(expression: string): CronParseResult {
  const trimmed = expression.trim();

  if (trimmed === "") {
    return { ok: false, error: "Cron expression is required." };
  }

  if (trimmed.length > WAKEUP_LIMITS.cronExpressionLength.max) {
    return {
      ok: false,
      error: `Cron expression must be ${WAKEUP_LIMITS.cronExpressionLength.max} characters or fewer.`,
    };
  }

  const fields = trimmed.split(/\s+/);
  if (fields.length !== 5) {
    return {
      ok: false,
      error: `Expected 5 fields (minute hour day-of-month month day-of-week), got ${fields.length}.`,
    };
  }

  const parsed: number[][] = [];
  for (const [index, spec] of FIELD_SPECS.entries()) {
    const result = parseField(fields[index], spec);
    if (typeof result === "string") {
      return { ok: false, error: result };
    }
    parsed.push(result);
  }

  return {
    ok: true,
    schedule: {
      minutes: parsed[0],
      hours: parsed[1],
      daysOfMonth: parsed[2],
      months: parsed[3],
      daysOfWeek: parsed[4],
      // Vixie cron treats any day field starting with `*` (including `*/2`) as
      // unrestricted, so it does not take part in the day-of-month OR
      // day-of-week rule below.
      restrictedDayOfMonth: !fields[2].startsWith("*"),
      restrictedDayOfWeek: !fields[4].startsWith("*"),
    },
  };
}

/** Normalises whitespace so equivalent expressions are stored identically. */
export function normalizeCronExpression(expression: string): string {
  return expression.trim().split(/\s+/).join(" ");
}

/**
 * Smallest gap (in minutes) between two consecutive runs of the schedule.
 *
 * Used to reject abusive custom schedules such as every minute. Only gaps
 * inside an hour and across two adjacent scheduled hours can be shorter than
 * an hour, so those are the only cases that need checking.
 */
export function getMinimumGapMinutes(schedule: CronSchedule): number {
  const { minutes, hours } = schedule;

  let smallest = Number.POSITIVE_INFINITY;

  for (let i = 1; i < minutes.length; i++) {
    smallest = Math.min(smallest, minutes[i] - minutes[i - 1]);
  }

  // Wrap from the last minute of one scheduled hour into the first minute of
  // the next, when those two hours are adjacent (24 hours also wraps 23 -> 0).
  const hasAdjacentHours =
    hours.length === 24 ||
    hours.some((hour, index) => index > 0 && hour - hours[index - 1] === 1);

  if (hasAdjacentHours) {
    const wrapGap = 60 - minutes[minutes.length - 1] + minutes[0];
    smallest = Math.min(smallest, wrapGap);
  }

  // A single run per scheduled hour with no adjacent hours is at least an hour
  // apart; fall back to 60 rather than reporting "infinite".
  return Number.isFinite(smallest) ? smallest : 60;
}

function matchesDay(schedule: CronSchedule, date: Date): boolean {
  if (!schedule.months.includes(date.getUTCMonth() + 1)) return false;

  const domMatches = schedule.daysOfMonth.includes(date.getUTCDate());
  const dowMatches = schedule.daysOfWeek.includes(date.getUTCDay());

  // Standard cron semantics: when both day fields are restricted the day
  // matches if *either* matches; otherwise only the restricted one counts.
  if (schedule.restrictedDayOfMonth && schedule.restrictedDayOfWeek) {
    return domMatches || dowMatches;
  }
  if (schedule.restrictedDayOfMonth) return domMatches;
  if (schedule.restrictedDayOfWeek) return dowMatches;
  return true;
}

/**
 * Returns the next UTC time matching the schedule strictly after `from`, or
 * null when nothing matches within the lookahead window (e.g. `0 0 30 2 *`).
 */
export function getNextCronRun(
  schedule: CronSchedule,
  from: Date = new Date(),
): Date | null {
  if (Number.isNaN(from.getTime())) return null;

  // Start at the next whole minute so the result is always in the future.
  const cursor = new Date(from.getTime());
  cursor.setUTCSeconds(0, 0);
  cursor.setUTCMinutes(cursor.getUTCMinutes() + 1);

  const startOfDay = Date.UTC(
    cursor.getUTCFullYear(),
    cursor.getUTCMonth(),
    cursor.getUTCDate(),
  );

  for (let dayOffset = 0; dayOffset <= MAX_LOOKAHEAD_DAYS; dayOffset++) {
    const day = new Date(startOfDay + dayOffset * 24 * 60 * 60 * 1000);
    if (!matchesDay(schedule, day)) continue;

    for (const hour of schedule.hours) {
      for (const minute of schedule.minutes) {
        const candidate = new Date(
          Date.UTC(
            day.getUTCFullYear(),
            day.getUTCMonth(),
            day.getUTCDate(),
            hour,
            minute,
          ),
        );
        if (candidate.getTime() >= cursor.getTime()) return candidate;
      }
    }
  }

  return null;
}

function formatList(values: number[], format: (value: number) => string) {
  const labels = values.map(format);
  if (labels.length === 1) return labels[0];
  if (labels.length === 2) return `${labels[0]} and ${labels[1]}`;
  return `${labels.slice(0, -1).join(", ")} and ${labels[labels.length - 1]}`;
}

const pad = (value: number) => String(value).padStart(2, "0");

/** Detects an evenly spaced field that starts at its minimum (a step field). */
function detectStep(values: number[], min: number, max: number): number | null {
  if (values.length < 2 || values[0] !== min) return null;

  const step = values[1] - values[0];
  if (step < 2) return null;

  for (let i = 1; i < values.length; i++) {
    if (values[i] - values[i - 1] !== step) return null;
  }
  // The final value must be the last one that fits inside the range.
  if (values[values.length - 1] + step <= max) return null;

  return step;
}

function describeTime(schedule: CronSchedule): string {
  const { minutes, hours } = schedule;
  const everyHour = hours.length === 24;
  const everyMinute = minutes.length === 60;

  if (everyMinute && everyHour) return "Every minute";

  const minuteStep = detectStep(minutes, 0, 59);
  if (minuteStep && everyHour) return `Every ${minuteStep} minutes`;

  const hourStep = detectStep(hours, 0, 23);
  if (hourStep && minutes.length === 1) {
    return minutes[0] === 0
      ? `Every ${hourStep} hours`
      : `Every ${hourStep} hours at :${pad(minutes[0])}`;
  }

  if (everyMinute) {
    return `Every minute of ${formatList(hours, (h) => `${pad(h)}:00`)}`;
  }

  if (minutes.length === 1 && hours.length === 1) {
    return `At ${pad(hours[0])}:${pad(minutes[0])}`;
  }

  if (everyHour) {
    return `Every hour at ${formatList(minutes, (m) => `:${pad(m)}`)}`;
  }

  const times: string[] = [];
  for (const hour of hours) {
    for (const minute of minutes) {
      times.push(`${pad(hour)}:${pad(minute)}`);
    }
  }
  // Long expansions become unreadable, so summarise instead.
  if (times.length > 6) {
    return `At ${formatList(minutes, (m) => `:${pad(m)}`)} past ${formatList(hours, (h) => `${pad(h)}:00`)}`;
  }
  return `At ${times.join(", ")}`;
}

function describeDays(schedule: CronSchedule): string {
  const parts: string[] = [];

  if (schedule.restrictedDayOfMonth) {
    parts.push(
      `on day ${formatList(schedule.daysOfMonth, String)} of the month`,
    );
  }

  if (schedule.restrictedDayOfWeek) {
    const weekdays = formatList(
      schedule.daysOfWeek,
      (day) => WEEKDAY_LABELS[day] ?? String(day),
    );
    parts.push(
      schedule.restrictedDayOfMonth ? `or on ${weekdays}` : `on ${weekdays}`,
    );
  }

  if (schedule.months.length !== 12) {
    parts.push(
      `in ${formatList(schedule.months, (month) => MONTH_LABELS[month - 1] ?? String(month))}`,
    );
  }

  if (parts.length === 0) return "every day";
  return parts.join(" ");
}

/**
 * Builds a human-readable summary of an already parsed schedule, e.g.
 * `"Every 6 hours, every day (UTC)"`.
 */
export function describeCronSchedule(schedule: CronSchedule): string {
  return `${describeTime(schedule)}, ${describeDays(schedule)} (UTC)`;
}

/**
 * Builds a human-readable summary of a cron expression. Returns the parse
 * error when the expression is invalid.
 */
export function describeCronExpression(expression: string): string {
  const result = parseCronExpression(expression);
  if (!result.ok) return result.error;

  return describeCronSchedule(result.schedule);
}
