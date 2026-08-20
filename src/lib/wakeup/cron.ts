// Lightweight 5-field cron parser/validator used by both the wakeup config
// (validation + human-readable preview) and the scheduled-wakeup evaluator in
// Phase 16. Deliberately dependency-free so it can run on the client (live
// preview) and server (validation) alike.

const FIELD_BOUNDS: Array<{ min: number; max: number; names?: string[] }> = [
  { min: 0, max: 59 }, // minute
  { min: 0, max: 23 }, // hour
  { min: 1, max: 31 }, // day of month
  {
    min: 1,
    max: 12,
    names: [
      "JAN",
      "FEB",
      "MAR",
      "APR",
      "MAY",
      "JUN",
      "JUL",
      "AUG",
      "SEP",
      "OCT",
      "NOV",
      "DEC",
    ],
  }, // month
  {
    min: 0,
    max: 7,
    names: ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"],
  }, // day of week (0/7=Sun)
];

const MONTH_NAMES = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];
const DOW_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export interface CronValidation {
  valid: boolean;
  error?: string;
}

function parseField(
  field: string,
  bounds: { min: number; max: number; names?: string[] },
): number[] | null {
  const values = new Set<number>();
  for (const part of field.split(",")) {
    if (part.length === 0) return null;
    let step = 1;
    let rangePart = part;
    if (part.includes("/")) {
      const [rp, stepStr] = part.split("/");
      rangePart = rp === "*" || rp === "" ? `${bounds.min}-${bounds.max}` : rp;
      const stepNum = Number(stepStr);
      if (!Number.isInteger(stepNum) || stepNum <= 0) return null;
      step = stepNum;
    }

    const [low, high] = rangePart.includes("-")
      ? rangePart.split("-")
      : [rangePart, rangePart];

    const resolve = (token: string): number | null => {
      if (token === "*") return null;
      if (bounds.names) {
        const idx = bounds.names.indexOf(token.toUpperCase());
        if (idx >= 0) return bounds.max === 7 && idx === 7 ? 0 : idx;
      }
      const n = Number(token);
      if (!Number.isInteger(n)) return null;
      // Cron convention: both 0 and 7 mean Sunday for day-of-week.
      if (bounds.max === 7 && n === 7) return 0;
      return n;
    };

    const lowVal = resolve(low);
    const highVal = resolve(high);
    if (lowVal === null && highVal === null) {
      values.add(0);
      continue;
    }
    const from = lowVal ?? bounds.min;
    const to = highVal ?? bounds.max;
    if (from < bounds.min || to > bounds.max || from > to) return null;
    for (let v = from; v <= to; v += step) values.add(v);
  }
  return Array.from(values).sort((a, b) => a - b);
}

export function validateCron(expression: string): CronValidation {
  const trimmed = expression.trim();
  if (trimmed.length === 0) {
    return { valid: false, error: "Cron expression is required." };
  }
  const fields = trimmed.split(/\s+/);
  if (fields.length !== 5) {
    return {
      valid: false,
      error: "Use 5 fields: minute hour day-of-month month day-of-week.",
    };
  }
  for (let i = 0; i < 5; i++) {
    const parsed = parseField(fields[i], FIELD_BOUNDS[i]);
    if (parsed === null) {
      return {
        valid: false,
        error: `Invalid ${["minute", "hour", "day of month", "month", "day of week"][i]} field: "${fields[i]}".`,
      };
    }
    if (parsed.length === 0) {
      return { valid: false, error: `Field "${fields[i]}" matched nothing.` };
    }
  }
  return { valid: true };
}

function describeField(
  field: string,
  label: string,
  _names?: string[],
): string {
  if (field === "*") return `every ${label}`;
  return `${label} ${field}`;
}

export function describeCron(expression: string): string {
  const validation = validateCron(expression);
  if (!validation.valid) return "Invalid expression";
  const [min, hour, _dom, mon, dow] = expression.trim().split(/\s+/);

  const parts: string[] = [];
  const monthTxt =
    mon === "*"
      ? ""
      : ` in ${mon
          .split(",")
          .map((m) => {
            const n = Number(m);
            return Number.isNaN(n) ? m : (MONTH_NAMES[Number(m) - 1] ?? m);
          })
          .join("/")}`;
  const dowTxt =
    dow === "*"
      ? ""
      : ` on ${dow
          .split(",")
          .map((d) => {
            const n = Number(d) % 7;
            return Number.isNaN(n) ? d : (DOW_NAMES[n] ?? d);
          })
          .join("/")}`;

  if (hour !== "*" && min !== "*") {
    parts.push(
      `At ${hour.split(",").join("/")}:${min.split(",").join("/")}${monthTxt}${dowTxt}`,
    );
  } else if (min !== "*" && hour === "*") {
    parts.push(`Every hour at minute ${min}${monthTxt}${dowTxt}`);
  } else if (min === "*" && hour === "*") {
    parts.push(`Every minute${monthTxt}${dowTxt}`);
  } else {
    parts.push(describeField(min, "minute"));
  }
  return parts.join(", ");
}

// Computes the next Date matching the expression at or after `from`
// (exclusive of the exact same minute). Returns null if no match within a year.
export function nextCronRun(
  expression: string,
  from: Date = new Date(),
): Date | null {
  const validation = validateCron(expression);
  if (!validation.valid) return null;

  const [minF, hourF, domF, monF, dowF] = expression.trim().split(/\s+/);
  // validateCron above guarantees each field parses to a non-empty number set.
  const asNumbers = (field: string, bounds: (typeof FIELD_BOUNDS)[number]) =>
    parseField(field, bounds) as number[];
  const minutes = asNumbers(minF, FIELD_BOUNDS[0]);
  const hours = asNumbers(hourF, FIELD_BOUNDS[1]);
  const doms = asNumbers(domF, FIELD_BOUNDS[2]);
  const months = asNumbers(monF, FIELD_BOUNDS[3]);
  const dows = asNumbers(dowF, FIELD_BOUNDS[4]);

  const candidate = new Date(from.getTime() + 60_000);
  candidate.setSeconds(0, 0);

  for (let i = 0; i < 366 * 24 * 60; i++) {
    const m = candidate.getMonth() + 1;
    const d = candidate.getDate();
    const dw = candidate.getDay();
    const h = candidate.getHours();
    const mi = candidate.getMinutes();

    if (!months.includes(m)) {
      candidate.setMonth(candidate.getMonth() + 1, 1);
      candidate.setHours(0, 0);
      continue;
    }
    // day-of-month and day-of-week: cron treats `* *` as OR, but a restricted
    // pair as AND. We honor the standard "either matches" when both are set,
    // falling back to AND only when both are restricted.
    const domRestricted = domF !== "*";
    const dowRestricted = dowF !== "*";
    const dayOk =
      !domRestricted && !dowRestricted
        ? true
        : domRestricted && dowRestricted
          ? doms.includes(d) && dows.includes(dw)
          : domRestricted
            ? doms.includes(d)
            : dows.includes(dw);

    if (!dayOk) {
      candidate.setDate(candidate.getDate() + 1);
      candidate.setHours(0, 0);
      continue;
    }
    if (!hours.includes(h) || !minutes.includes(mi)) {
      candidate.setMinutes(candidate.getMinutes() + 1);
      continue;
    }
    return new Date(candidate);
  }
  return null;
}
