export type ScheduleMode = "interval" | "daily" | "custom";

export interface ScheduleInput {
  scheduleMode: ScheduleMode;
  intervalHours: number;
  dailyTimes: string[];
  cronExpression: string | null;
}

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

export function isDailyTime(value: string): boolean {
  return TIME_RE.test(value);
}

/**
 * Hard ceiling on a stored cron expression. The expression is attacker
 * controlled (any signed-in user can persist one), and it is re-parsed by the
 * shared background evaluator, so its parse cost must be bounded before it is
 * ever accepted.
 */
export const MAX_CRON_LENGTH = 120;
/** Bounds the comma-separated list length of a single field. */
const MAX_FIELD_PARTS = 60;

/**
 * Validates a standard 5-field cron expression
 * (`minute hour day-of-month month day-of-week`). Supports `*`, lists (`a,b`),
 * ranges (`a-b`) and steps (`*\/n`, `a-b/n`). No support for names (e.g. `MON`)
 * or the non-standard `@daily` macros.
 */
export function isValidCronExpression(expr: string): boolean {
  return parseCronExpression(expr) !== null;
}

interface CronSpec {
  minutes: number[];
  hours: number[];
  dom: Set<number>;
  month: Set<number>;
  dow: Set<number>;
  domRestricted: boolean;
  dowRestricted: boolean;
}

/**
 * Parses a cron expression into pre-computed match sets, or null when the
 * expression is malformed or exceeds the size budget.
 *
 * Parsing is done once and reused for every candidate instant: re-parsing per
 * minute turned a "next trigger" preview into a multi-hundred-million-operation
 * loop that a single stored expression could aim at the server.
 */
function parseCronExpression(expr: string): CronSpec | null {
  if (typeof expr !== "string") return null;

  const trimmed = expr.trim();
  if (trimmed.length === 0 || trimmed.length > MAX_CRON_LENGTH) return null;

  const fields = trimmed.split(/\s+/);
  if (fields.length !== 5) return null;

  const [minute, hour, dom, month, dow] = fields;

  const minuteSet = parseField(minute, 0, 59);
  const hourSet = parseField(hour, 0, 23);
  const domSet = parseField(dom, 1, 31);
  const monthSet = parseField(month, 1, 12);
  // 0 and 7 both mean Sunday in cron.
  const dowSet = parseField(dow, 0, 7);
  if (!minuteSet || !hourSet || !domSet || !monthSet || !dowSet) {
    return null;
  }

  // Normalize cron's two spellings of Sunday so lookups only need `getDay()`.
  if (dowSet.has(7)) dowSet.add(0);

  return {
    minutes: [...minuteSet].sort((a, b) => a - b),
    hours: [...hourSet].sort((a, b) => a - b),
    dom: domSet,
    month: monthSet,
    dow: dowSet,
    domRestricted: dom !== "*",
    dowRestricted: dow !== "*",
  };
}

function parseField(
  field: string,
  min: number,
  max: number,
): Set<number> | null {
  const result = new Set<number>();

  const parts = field.split(",");
  if (parts.length > MAX_FIELD_PARTS) return null;

  for (const part of parts) {
    if (part.length === 0) return null;

    let step = 1;
    let range = part;
    if (part.includes("/")) {
      const [rangePart, stepPart] = part.split("/");
      step = Number.parseInt(stepPart, 10);
      if (!Number.isInteger(step) || step < 1) return null;
      range = rangePart === "*" ? `${min}-${max}` : rangePart;
    }

    let lo = min;
    let hi = max;
    if (range.includes("-")) {
      const [a, b] = range.split("-");
      lo = Number.parseInt(a, 10);
      hi = Number.parseInt(b, 10);
      if (!Number.isInteger(lo) || !Number.isInteger(hi)) return null;
    } else if (range === "*") {
      lo = min;
      hi = max;
    } else {
      const v = Number.parseInt(range, 10);
      if (!Number.isInteger(v)) return null;
      lo = hi = v;
    }

    if (lo < min || hi > max || lo > hi) return null;

    for (let i = lo; i <= hi; i += step) result.add(i);
  }

  return result;
}

function cronDayMatches(spec: CronSpec, date: Date): boolean {
  if (!spec.month.has(date.getMonth() + 1)) return false;

  const d = date.getDate();
  const dw = date.getDay(); // 0 (Sun) .. 6 (Sat)

  // Standard cron semantics: when both day fields are restricted they are ORed.
  if (spec.domRestricted && spec.dowRestricted) {
    return spec.dom.has(d) || spec.dow.has(dw);
  }
  if (spec.domRestricted) return spec.dom.has(d);
  if (spec.dowRestricted) return spec.dow.has(dw);
  return true;
}

const TRIGGER_WINDOW_MS = 5 * 60 * 1000;
/**
 * Day-granularity search horizon. Four years covers the rarest legitimate
 * schedule (Feb 29) while keeping a never-matching expression — `0 0 30 2 *` is
 * accepted by every cron parser and matches no date — to a few thousand cheap
 * comparisons instead of a million date mutations.
 */
const MAX_LOOKAHEAD_DAYS = 4 * 366;

/**
 * Computes the next time a schedule would fire on or after `from`. Returns null
 * if no occurrence exists within the search horizon (an expression such as
 * February 30th never fires).
 */
export function getNextTriggerTime(
  from: Date,
  schedule: ScheduleInput,
): Date | null {
  const cursor = new Date(from);
  cursor.setSeconds(0, 0);

  if (schedule.scheduleMode === "interval") {
    const hours = Math.max(1, Math.min(24, schedule.intervalHours || 6));
    return new Date(cursor.getTime() + hours * 60 * 60 * 1000);
  }

  if (schedule.scheduleMode === "daily") {
    const times = schedule.dailyTimes
      .filter(isDailyTime)
      .map((t) => {
        const [h, m] = t.split(":").map(Number);
        return h * 60 + m;
      })
      .sort((a, b) => a - b);
    if (times.length === 0) return null;

    const nowMinutes = cursor.getHours() * 60 + cursor.getMinutes();
    let target = times.find((t) => t > nowMinutes);
    if (target === undefined) target = times[0]; // wrap to next day's first time

    const result = new Date(cursor);
    const dayOffset = target > nowMinutes ? 0 : 1;
    result.setDate(result.getDate() + dayOffset);
    result.setHours(Math.floor(target / 60), target % 60, 0, 0);
    return result;
  }

  // Custom cron. The expression is parsed exactly once, then the search walks
  // day by day (at most MAX_LOOKAHEAD_DAYS iterations) and only descends into
  // hours/minutes on a day the date fields already match.
  const spec = parseCronExpression(schedule.cronExpression ?? "");
  if (!spec) return null;

  const floor = cursor.getTime();
  const day = new Date(cursor);
  day.setHours(0, 0, 0, 0);

  for (let i = 0; i <= MAX_LOOKAHEAD_DAYS; i++) {
    if (cronDayMatches(spec, day)) {
      for (const h of spec.hours) {
        for (const m of spec.minutes) {
          const candidate = new Date(day);
          candidate.setHours(h, m, 0, 0);
          if (candidate.getTime() >= floor) return candidate;
        }
      }
    }
    day.setDate(day.getDate() + 1);
  }

  return null;
}

/**
 * Decides whether a schedule should fire right now. Used by the Inngest cron
 * evaluator (Phase 16) to fan out per-user triggers.
 */
export function shouldTriggerNow(
  schedule: ScheduleInput,
  lastTrigger: Date | null,
  now: Date,
): boolean {
  if (schedule.scheduleMode === "interval") {
    if (!lastTrigger) return true;
    const elapsed = now.getTime() - lastTrigger.getTime();
    return elapsed >= schedule.intervalHours * 60 * 60 * 1000;
  }

  if (schedule.scheduleMode === "daily") {
    const windowStart = now.getTime() - TRIGGER_WINDOW_MS;
    for (const t of schedule.dailyTimes.filter(isDailyTime)) {
      const [h, m] = t.split(":").map(Number);
      const occ = new Date(now);
      occ.setHours(h, m, 0, 0);
      const start = occ.getTime();
      if (start < windowStart) continue; // already passed this occurrence
      if (now.getTime() < start || now.getTime() > start + TRIGGER_WINDOW_MS) {
        continue;
      }
      // Fire if we haven't already fired for this occurrence.
      if (!lastTrigger || lastTrigger.getTime() < start) return true;
    }
    return false;
  }

  // custom cron
  const occ = getNextTriggerTime(
    new Date(now.getTime() - TRIGGER_WINDOW_MS),
    schedule,
  );
  if (!occ) return false;
  const start = occ.getTime();
  if (now.getTime() < start || now.getTime() > start + TRIGGER_WINDOW_MS) {
    return false;
  }
  return !lastTrigger || lastTrigger.getTime() < start;
}
