/**
 * Strict 5-field cron parsing (minute hour day-of-month month day-of-week).
 *
 * Cron expressions are untrusted user input that is persisted and later
 * consumed by the scheduler, so parsing is deliberately strict:
 *
 * - The expression is length-bounded and restricted to `0-9 * / , -` plus
 *   space/tab separators *before* it is split. Newlines and control characters
 *   are rejected outright so a stored value can never smuggle an extra line
 *   into anything crontab-shaped downstream.
 * - `Number.parseInt` is not used for tokens: it silently accepts trailing
 *   garbage (`Number.parseInt("2abc") === 2`), which let malformed step
 *   suffixes like `/2abc` pass validation.
 * - Validation and evaluation share this one parser, so an expression can never
 *   be accepted by the validator and then re-interpreted differently when the
 *   next trigger time is computed.
 */

export const MAX_CRON_EXPRESSION_LENGTH = 100;
export const CRON_FIELD_COUNT = 5;

/** Only cron syntax characters and horizontal whitespace. No newlines. */
const CRON_SHAPE_RE = /^[0-9*/,\- \t]+$/;
const FIELD_SEPARATOR_RE = /[ \t]+/;
const UNSIGNED_INT_RE = /^\d{1,2}$/;

interface CronFieldSpec {
  min: number;
  max: number;
  /** Maps a 0-7 day-of-week value so both 0 and 7 mean Sunday. */
  normalize?: (value: number) => number;
}

const FIELD_SPECS: readonly CronFieldSpec[] = [
  { min: 0, max: 59 }, // minute
  { min: 0, max: 23 }, // hour
  { min: 1, max: 31 }, // day of month
  { min: 1, max: 12 }, // month
  { min: 0, max: 7, normalize: (v) => (v === 7 ? 0 : v) }, // day of week
];

export interface ParsedCron {
  minutes: ReadonlySet<number>;
  hours: ReadonlySet<number>;
  daysOfMonth: ReadonlySet<number>;
  months: ReadonlySet<number>;
  daysOfWeek: ReadonlySet<number>;
}

function parseUnsignedInt(token: string): number | null {
  return UNSIGNED_INT_RE.test(token) ? Number(token) : null;
}

function expandField(part: string, spec: CronFieldSpec): Set<number> | null {
  const slashIndex = part.indexOf("/");
  let range = part;
  let step = 1;

  if (slashIndex !== -1) {
    range = part.slice(0, slashIndex);
    // Rejects both a missing step ("5/") and a second slash ("* / 2 / 3"
    // written without spaces), which the previous validator accepted while the
    // evaluator refused it.
    const parsedStep = parseUnsignedInt(part.slice(slashIndex + 1));
    if (parsedStep === null || parsedStep < 1) return null;
    step = parsedStep;
  }

  const values = new Set<number>();
  const addRange = (lo: number, hi: number): boolean => {
    if (lo < spec.min || hi > spec.max || lo > hi) return false;
    for (let v = lo; v <= hi; v += step) {
      values.add(spec.normalize ? spec.normalize(v) : v);
    }
    return true;
  };

  if (range === "*") {
    return addRange(spec.min, spec.max) ? values : null;
  }

  for (const token of range.split(",")) {
    const dashIndex = token.indexOf("-");
    if (dashIndex !== -1) {
      const lo = parseUnsignedInt(token.slice(0, dashIndex));
      const hi = parseUnsignedInt(token.slice(dashIndex + 1));
      if (lo === null || hi === null) return null;
      if (!addRange(lo, hi)) return null;
    } else {
      const value = parseUnsignedInt(token);
      if (value === null) return null;
      // Vixie cron: a bare value with a step ("5/2") means "value..max/step".
      if (!addRange(value, slashIndex !== -1 ? spec.max : value)) return null;
    }
  }

  return values.size > 0 ? values : null;
}

/**
 * Parses a 5-field cron expression into the set of matching values per field.
 * Returns `null` for anything malformed, out of range, or over-long.
 */
export function parseCron(expr: string): ParsedCron | null {
  if (typeof expr !== "string") return null;

  const trimmed = expr.trim();
  if (!trimmed || trimmed.length > MAX_CRON_EXPRESSION_LENGTH) return null;
  if (!CRON_SHAPE_RE.test(trimmed)) return null;

  const parts = trimmed.split(FIELD_SEPARATOR_RE);
  if (parts.length !== CRON_FIELD_COUNT) return null;

  const sets: Set<number>[] = [];
  for (let i = 0; i < CRON_FIELD_COUNT; i++) {
    const expanded = expandField(parts[i], FIELD_SPECS[i]);
    if (expanded === null) return null;
    sets.push(expanded);
  }

  const [minutes, hours, daysOfMonth, months, daysOfWeek] = sets;
  return { minutes, hours, daysOfMonth, months, daysOfWeek };
}

export function isValidCron(expr: string): boolean {
  return parseCron(expr) !== null;
}
