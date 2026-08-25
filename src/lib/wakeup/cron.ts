// Minimal standard 5-field cron parser (minute hour day-of-month month
// day-of-week) with validation, next-run computation, and a human-readable
// description. Pure and dependency-free so it is safe to import from client
// components as well as server routes.

const MONTH_NAMES = [
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

const DAY_NAMES = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];

interface FieldSpec {
  name: string;
  min: number;
  max: number;
  /** Extra aliases accepted in place of numbers ("sun".."sat", "jan".."dec"). */
  aliases?: Record<string, number>;
}

const FIELD_SPECS: FieldSpec[] = [
  { name: "minute", min: 0, max: 59 },
  { name: "hour", min: 0, max: 23 },
  { name: "day of month", min: 1, max: 31 },
  { name: "month", min: 1, max: 12, aliases: buildMonthAliases() },
  { name: "day of week", min: 0, max: 7, aliases: buildDayAliases() },
];

function buildMonthAliases(): Record<string, number> {
  const aliases: Record<string, number> = {};
  for (const [index, name] of MONTH_NAMES.entries()) {
    aliases[name.toLowerCase()] = index + 1;
    aliases[name.slice(0, 3).toLowerCase()] = index + 1;
  }
  return aliases;
}

function buildDayAliases(): Record<string, number> {
  const aliases: Record<string, number> = {
    sunday: 0,
    sun: 0,
    // Both 0 and 7 mean Sunday.
    "7": 0,
  };
  for (let day = 1; day < DAY_NAMES.length; day++) {
    const name = DAY_NAMES[day].toLowerCase();
    aliases[name] = day;
    aliases[name.slice(0, 3)] = day;
  }
  return aliases;
}

export interface CronFields {
  minutes: Set<number>;
  hours: Set<number>;
  daysOfMonth: Set<number>;
  months: Set<number>;
  daysOfWeek: Set<number>;
  domRestricted: boolean;
  dowRestricted: boolean;
}

export type CronParseResult =
  | { ok: true; fields: CronFields }
  | { ok: false; error: string };

export function isValidCronExpression(expression: string): boolean {
  return parseCronExpression(expression).ok;
}

export function parseCronExpression(expression: string): CronParseResult {
  const trimmed = expression.trim().replace(/\s+/g, " ");
  if (!trimmed) {
    return { ok: false, error: "Cron expression is empty." };
  }

  const parts = trimmed.split(" ");
  if (parts.length !== 5) {
    return {
      ok: false,
      error: `Expected 5 fields (minute hour day-of-month month day-of-week), got ${parts.length}.`,
    };
  }

  const sets: Set<number>[] = [];
  for (const [index, part] of parts.entries()) {
    const spec = FIELD_SPECS[index];
    if (!spec) {
      return { ok: false, error: "Unexpected cron field." };
    }
    const parsed = parseField(part, spec);
    if (!parsed.ok) return parsed;
    sets.push(parsed.values);
  }

  const [minutes, hours, daysOfMonth, months, daysOfWeek] = sets;
  if (!minutes || !hours || !daysOfMonth || !months || !daysOfWeek) {
    return { ok: false, error: "Unexpected cron field." };
  }

  return {
    ok: true,
    fields: {
      minutes,
      hours,
      daysOfMonth,
      months,
      daysOfWeek,
      domRestricted: !isAnyValue(parts[2]),
      dowRestricted: !isAnyValue(parts[4]),
    },
  };
}

/**
 * True when the field is "*" or a starred step (star, slash, then a number —
 * i.e. matches every value). Vixie cron treats starred steps as unrestricted
 * for the day fields, which decides how dom/dow combine in dayMatches().
 */
function isAnyValue(part: string | undefined): boolean {
  if (!part) return false;
  if (part.startsWith("*/")) return true;
  return part === "*";
}

function parseField(
  part: string,
  spec: FieldSpec,
): { ok: true; values: Set<number> } | { ok: false; error: string } {
  const values = new Set<number>();
  for (const term of part.split(",")) {
    if (!term) {
      return { ok: false, error: `Empty list item in ${spec.name} field.` };
    }

    let rangePart = term;
    let step = 1;
    const stepSplit = term.split("/");
    if (stepSplit.length > 2) {
      return { ok: false, error: `Invalid step in ${spec.name} field.` };
    }
    if (stepSplit.length === 2) {
      rangePart = stepSplit[0] ?? "";
      const parsedStep = parseNumber(stepSplit[1], spec);
      if (parsedStep === null || parsedStep < 1) {
        return { ok: false, error: `Invalid step in ${spec.name} field.` };
      }
      step = parsedStep;
    }

    let start: number;
    let end: number;
    if (rangePart === "*") {
      start = spec.min;
      end = spec.max;
    } else if (rangePart.includes("-")) {
      const bounds = rangePart.split("-");
      if (bounds.length !== 2) {
        return { ok: false, error: `Invalid range in ${spec.name} field.` };
      }
      const parsedStart = parseNumber(bounds[0], spec);
      const parsedEnd = parseNumber(bounds[1], spec);
      if (parsedStart === null || parsedEnd === null) {
        return { ok: false, error: `Invalid value in ${spec.name} field.` };
      }
      start = parsedStart;
      end = parsedEnd;
    } else {
      const single = parseNumber(rangePart, spec);
      if (single === null) {
        return { ok: false, error: `Invalid value in ${spec.name} field.` };
      }
      start = single;
      end = stepSplit.length === 2 ? spec.max : single;
    }

    if (start > end) {
      return {
        ok: false,
        error: `Start of range exceeds end in ${spec.name}.`,
      };
    }
    if (start < spec.min || end > spec.max) {
      return {
        ok: false,
        error: `${spec.name} must be between ${spec.min} and ${spec.max}${spec.max === 7 && spec.min === 0 ? " (7 means Sunday)" : ""}.`,
      };
    }
    for (let value = start; value <= end; value += step) {
      // Day-of-week accepts both 0 and 7 for Sunday.
      values.add(spec.max === 7 && value === 7 ? 0 : value);
    }
  }
  return { ok: true, values };
}

function parseNumber(raw: string | undefined, spec: FieldSpec): number | null {
  if (!raw) return null;
  const lowered = raw.toLowerCase();
  if (spec.aliases && lowered in spec.aliases) {
    return spec.aliases[lowered] ?? null;
  }
  if (!/^\d+$/.test(lowered)) return null;
  return Number.parseInt(lowered, 10);
}

function dayMatches(fields: CronFields, date: Date): boolean {
  const domOk = fields.daysOfMonth.has(date.getDate());
  const dowOk = fields.daysOfWeek.has(date.getDay());
  // Standard Vixie semantics: when both day fields are restricted, either one
  // may match; otherwise the restricted field decides.
  if (fields.domRestricted && fields.dowRestricted) return domOk || dowOk;
  if (fields.domRestricted) return domOk;
  if (fields.dowRestricted) return dowOk;
  return true;
}

/**
 * Next run strictly after `from`, or null when no match exists within four
 * years (e.g. Feb 30). Uses local time consistently with the rest of the app.
 */
export function nextCronRun(fields: CronFields, from: Date): Date | null {
  const candidate = new Date(from.getTime());
  candidate.setSeconds(0, 0);
  candidate.setMinutes(candidate.getMinutes() + 1);

  const maxDayOffset = 366 * 4;
  for (let offset = 0; offset <= maxDayOffset; offset++) {
    // Constructor arithmetic overflows safely: date + N rolls into following
    // months/years.
    const day = new Date(
      candidate.getFullYear(),
      candidate.getMonth(),
      candidate.getDate() + offset,
    );

    if (!fields.months.has(day.getMonth() + 1)) continue;
    if (!dayMatches(fields, day)) continue;

    const firstMinuteOfDay =
      offset === 0 ? candidate.getHours() * 60 + candidate.getMinutes() : 0;

    for (let minuteOfDay = firstMinuteOfDay; minuteOfDay < 1440; ) {
      const hour = Math.floor(minuteOfDay / 60);
      const minute = minuteOfDay % 60;
      if (fields.hours.has(hour)) {
        const nextMinuteAfterHour = nextAtLeast(fields.minutes, minute);
        if (nextMinuteAfterHour !== null) {
          return new Date(
            day.getFullYear(),
            day.getMonth(),
            day.getDate(),
            hour,
            nextMinuteAfterHour,
          );
        }
        // Jump to the start of the next hour within the same day.
        minuteOfDay = (hour + 1) * 60;
      } else {
        minuteOfDay = (hour + 1) * 60;
      }
    }
  }
  return null;
}

function nextAtLeast(sortedSet: Set<number>, min: number): number | null {
  let best: number | null = null;
  for (const value of sortedSet) {
    if (value >= min && (best === null || value < best)) best = value;
  }
  return best;
}

/** Human-readable summary like "At 09:00, 15:00 every Monday, Friday". */
export function describeCron(expression: string): string {
  const parsed = parseCronExpression(expression);
  if (!parsed.ok) return parsed.error;
  const { fields } = parsed;

  const times: string[] = [];
  for (const hour of [...fields.hours].sort((a, b) => a - b)) {
    for (const minute of [...fields.minutes].sort((a, b) => a - b)) {
      times.push(formatTime(hour, minute));
    }
  }
  let timeText: string;
  if (times.length > 8) {
    timeText = `minute ${joinList([...fields.minutes])} past hour ${joinList([...fields.hours])}`;
  } else {
    timeText = `At ${times.join(", ")}`;
  }

  const fragments: string[] = [];
  if (!fields.domRestricted && !fields.dowRestricted) {
    fragments.push("every day");
  } else if (fields.dowRestricted && !fields.domRestricted) {
    fragments.push(`on ${describeDaysOfWeek(fields.daysOfWeek)}`);
  } else if (fields.domRestricted && !fields.dowRestricted) {
    fragments.push(`on day ${joinList([...fields.daysOfMonth])} of the month`);
  } else {
    fragments.push(
      `on ${describeDaysOfWeek(fields.daysOfWeek)} or day ${joinList([...fields.daysOfMonth])}`,
    );
  }

  if (fields.months.size !== 12) {
    fragments.push(
      `in ${joinList([...fields.months].map((m) => MONTH_NAMES[m - 1] ?? String(m)))}`,
    );
  }

  return `${timeText} ${fragments.join(", ")}`;
}

function describeDaysOfWeek(days: Set<number>): string {
  return joinList(
    [...days].sort((a, b) => a - b).map((day) => DAY_NAMES[day] ?? String(day)),
  );
}

function joinList(values: (string | number)[]): string {
  const list = values.map(String);
  if (list.length <= 1) return list[0] ?? "";
  if (list.length === 2) return `${list[0]} and ${list[1]}`;
  return `${list.slice(0, -1).join(", ")}, and ${list[list.length - 1]}`;
}

function formatTime(hour: number, minute: number): string {
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}
