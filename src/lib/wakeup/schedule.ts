import type { WakeupConfig } from "@/lib/types/wakeup";

// Standard 5-field cron ranges: minute, hour, day-of-month, month, day-of-week.
const CRON_FIELD_RANGES: ReadonlyArray<readonly [number, number]> = [
  [0, 59],
  [0, 23],
  [1, 31],
  [1, 12],
  [0, 7], // 0 and 7 both mean Sunday in cron
];

const DAILY_TIME_RE = /^([01]?\d|2[0-3]):[0-5]\d$/;

function isInteger(value: number): value is number {
  return Number.isInteger(value);
}

function inRange(value: number, min: number, max: number): boolean {
  return value >= min && value <= max;
}

// Parses a single cron field (e.g. "*/15", "1-5", "0,30", "*") into the set of
// matching values. Returns null when the field is malformed. Step values,
// ranges, and comma-lists are all supported.
function parseCronField(
  field: string,
  min: number,
  max: number,
): Set<number> | null {
  if (field === "*") {
    const all = new Set<number>();
    for (let i = min; i <= max; i++) all.add(i);
    return all;
  }

  const result = new Set<number>();
  for (const part of field.split(",")) {
    if (part.length === 0) return null;

    let step = 1;
    let range = part;
    const slashIndex = part.indexOf("/");
    if (slashIndex !== -1) {
      const stepText = part.slice(slashIndex + 1);
      step = Number(stepText);
      if (!isInteger(step) || step <= 0) return null;
      range = part.slice(0, slashIndex);
    }

    if (range === "*") {
      for (let i = min; i <= max; i += step) result.add(i);
    } else if (range.includes("-")) {
      // Require exactly two non-empty endpoints so malformed syntax like "--"
      // or "1-2-3" is rejected rather than silently parsed.
      const rangeParts = range.split("-");
      if (rangeParts.length !== 2 || rangeParts.some((p) => p.length === 0)) {
        return null;
      }
      const [aText, bText] = rangeParts;
      const a = Number(aText);
      const b = Number(bText);
      if (
        !isInteger(a) ||
        !isInteger(b) ||
        !inRange(a, min, max) ||
        !inRange(b, min, max) ||
        a > b
      ) {
        return null;
      }
      for (let i = a; i <= b; i += step) result.add(i);
    } else {
      const n = Number(range);
      if (!isInteger(n) || !inRange(n, min, max)) return null;
      // A stepped singleton such as "5/15" expands from n through max.
      if (step > 1) {
        for (let i = n; i <= max; i += step) result.add(i);
      } else {
        result.add(n);
      }
    }
  }

  if (result.size === 0) return null;
  return result;
}

export function isValidCronExpression(expression: string): boolean {
  const fields = expression.trim().split(/\s+/);
  if (fields.length !== 5) return false;

  for (let i = 0; i < 5; i++) {
    const field = fields[i];
    // "?" is a no-op wildcard for day-of-month / day-of-week only.
    if ((i === 2 || i === 4) && field === "?") continue;
    const [min, max] = CRON_FIELD_RANGES[i];
    const parsed = parseCronField(field, min, max);
    if (!parsed || parsed.size === 0) return false;
  }
  return true;
}

// Computes the next date at or after `from` (rounded up to the next minute)
// that satisfies the cron expression. Returns null when the expression is
// invalid or no match occurs within 5 years.
export function nextCronRun(
  expression: string,
  from: Date = new Date(),
): Date | null {
  if (!isValidCronExpression(expression)) return null;

  const fields = expression.trim().split(/\s+/);
  const minutes = parseCronField(fields[0], 0, 59);
  const hours = parseCronField(fields[1], 0, 23);
  const months = parseCronField(fields[3], 1, 12);
  if (!minutes || !hours || !months) return null;

  const domField = fields[2];
  const domRestricted = domField !== "*" && domField !== "?";
  const doms = domRestricted ? parseCronField(domField, 1, 31) : null;

  const dowField = fields[4];
  const dowRestricted = dowField !== "*" && dowField !== "?";
  const dowSet = new Set<number>();
  const dowParsed = parseCronField(dowField === "?" ? "*" : dowField, 0, 7);
  if (!dowParsed) return null;
  for (const value of dowParsed) {
    dowSet.add(value % 7);
  }

  const cursor = new Date(from.getTime() + 60_000);
  cursor.setSeconds(0, 0);
  const limit = new Date(from.getTime() + 5 * 365 * 24 * 60 * 60 * 1000);

  // Bound the loop so a pathological schedule can never spin forever.
  for (let guard = 0; guard < 2_000_000 && cursor <= limit; guard++) {
    const month = cursor.getMonth() + 1;
    if (!months.has(month)) {
      cursor.setMonth(cursor.getMonth() + 1, 1);
      cursor.setHours(0, 0, 0, 0);
      continue;
    }

    const dayOfMonth = cursor.getDate();
    const dayOfWeek = cursor.getDay();
    // The OR rule (day-of-month OR day-of-week) only applies when BOTH day
    // fields are actually restricted. When only one is restricted, the other is
    // a wildcard and must not force a match on every date (e.g. "0 0 15 * *"
    // should run only on the 15th).
    const dayMatches =
      doms && dowRestricted
        ? doms.has(dayOfMonth) || dowSet.has(dayOfWeek)
        : doms
          ? doms.has(dayOfMonth)
          : dowRestricted
            ? dowSet.has(dayOfWeek)
            : true;
    if (!dayMatches) {
      cursor.setDate(cursor.getDate() + 1);
      cursor.setHours(0, 0, 0, 0);
      continue;
    }

    const hour = cursor.getHours();
    if (!hours.has(hour)) {
      cursor.setHours(hour + 1, 0, 0, 0);
      continue;
    }

    const minute = cursor.getMinutes();
    if (!minutes.has(minute)) {
      cursor.setMinutes(minute + 1, 0, 0);
      continue;
    }

    return new Date(cursor);
  }

  return null;
}

function nextDailyRun(times: string[], from: Date): Date | null {
  const candidates = times
    .filter((time) => DAILY_TIME_RE.test(time))
    .map((time) => {
      const [h, m] = time.split(":").map(Number);
      const candidate = new Date(from);
      candidate.setSeconds(0, 0);
      candidate.setHours(h, m, 0, 0);
      if (candidate.getTime() <= from.getTime()) {
        candidate.setDate(candidate.getDate() + 1);
      }
      return candidate;
    });

  if (candidates.length === 0) return null;
  return candidates.sort((a, b) => a.getTime() - b.getTime())[0];
}

// Human-readable preview of the next scheduled trigger based on the active
// schedule mode. Returns null when the config cannot produce a next time.
export function nextTriggerTime(
  config: Pick<
    WakeupConfig,
    "scheduleMode" | "intervalHours" | "dailyTimes" | "cronExpression"
  >,
  from: Date = new Date(),
): Date | null {
  switch (config.scheduleMode) {
    case "interval":
      return new Date(from.getTime() + config.intervalHours * 60 * 60 * 1000);
    case "daily":
      return nextDailyRun(config.dailyTimes, from);
    case "custom":
      return config.cronExpression
        ? nextCronRun(config.cronExpression, from)
        : null;
    default:
      return null;
  }
}

export { DAILY_TIME_RE };
