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
 * Validates a standard 5-field cron expression
 * (`minute hour day-of-month month day-of-week`). Supports `*`, lists (`a,b`),
 * ranges (`a-b`) and steps (`*\/n`, `a-b/n`). No support for names (e.g. `MON`)
 * or the non-standard `@daily` macros.
 */
export function isValidCronExpression(expr: string): boolean {
  const fields = expr.trim().split(/\s+/);
  if (fields.length !== 5) return false;

  const [minute, hour, dom, month, dow] = fields;

  const minuteSet = parseField(minute, 0, 59);
  const hourSet = parseField(hour, 0, 23);
  const domSet = parseField(dom, 1, 31);
  const monthSet = parseField(month, 1, 12);
  // 0 and 7 both mean Sunday in cron.
  const dowSet = parseField(dow, 0, 7);
  if (!minuteSet || !hourSet || !domSet || !monthSet || !dowSet) {
    return false;
  }
  // Avoid the ambiguous "never matches" combination where both day fields are
  // restricted (cron ORs them, but an empty set on either side still works).
  return true;
}

function parseField(
  field: string,
  min: number,
  max: number,
): Set<number> | null {
  const result = new Set<number>();

  for (const part of field.split(",")) {
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

function cronFieldsMatch(fields: string[], date: Date): boolean {
  const [minute, hour, dom, month, dow] = fields;
  const minuteSet = parseField(minute, 0, 59);
  const hourSet = parseField(hour, 0, 23);
  const domSet = parseField(dom, 1, 31);
  const monthSet = parseField(month, 1, 12);
  const dowSet = parseField(dow, 0, 7);
  if (!minuteSet || !hourSet || !domSet || !monthSet || !dowSet) return false;

  const m = date.getMinutes();
  const h = date.getHours();
  const d = date.getDate();
  const mo = date.getMonth() + 1;
  const dw = date.getDay(); // 0 (Sun) .. 6 (Sat)

  if (!minuteSet.has(m) || !hourSet.has(h)) return false;
  if (!monthSet.has(mo)) return false;

  const domRestricted = dom !== "*";
  const dowRestricted = dow !== "*";

  if (domRestricted && dowRestricted) {
    return domSet.has(d) || dowSet.has(dw);
  }
  if (domRestricted) return domSet.has(d);
  if (dowRestricted) return dowSet.has(dw);
  return true;
}

const TRIGGER_WINDOW_MS = 5 * 60 * 1000;
const MAX_LOOKAHEAD_MS = 2 * 365 * 24 * 60 * 60 * 1000;

/**
 * Computes the next time a schedule would fire on or after `from`. Returns null
 * if no occurrence is found within a 2-year horizon (shouldn't happen for valid
 * schedules).
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

  // custom cron
  const expr = schedule.cronExpression?.trim();
  if (!expr || !isValidCronExpression(expr)) return null;
  const fields = expr.split(/\s+/);

  const limit = cursor.getTime() + MAX_LOOKAHEAD_MS;
  const candidate = new Date(cursor);
  candidate.setSeconds(0, 0);
  while (candidate.getTime() <= limit) {
    if (cronFieldsMatch(fields, candidate)) return new Date(candidate);
    candidate.setMinutes(candidate.getMinutes() + 1);
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
