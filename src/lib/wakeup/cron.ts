/**
 * Lightweight 5-field cron validator (minute hour day-of-month month day-of-week).
 * Supports wildcard, step intervals, numeric ranges, range steps, comma lists,
 * and single values. Day-of-week accepts both 0 and 7 for Sunday.
 */
const FIELD_RANGES: ReadonlyArray<[number, number]> = [
  [0, 59],
  [0, 23],
  [1, 31],
  [1, 12],
  [0, 7],
];

export function isValidCron(expr: string): boolean {
  const trimmed = expr.trim();
  if (!trimmed) return false;
  const parts = trimmed.split(/\s+/);
  if (parts.length !== 5) return false;

  return parts.every((part, i) => isValidField(part, FIELD_RANGES[i]));
}

function isValidField(part: string, [min, max]: [number, number]): boolean {
  if (part.includes("/")) {
    const [range, stepStr] = part.split("/");
    const step = Number.parseInt(stepStr, 10);
    if (Number.isNaN(step) || step < 1) return false;
    if (range === "*") return true;
    return isValidRangeOrValue(range, min, max);
  }

  if (part === "*") return true;
  return isValidRangeOrValue(part, min, max);
}

function isValidRangeOrValue(part: string, min: number, max: number): boolean {
  for (const token of part.split(",")) {
    if (token.includes("-")) {
      const [loStr, hiStr] = token.split("-");
      const lo = Number.parseInt(loStr, 10);
      const hi = Number.parseInt(hiStr, 10);
      if (Number.isNaN(lo) || Number.isNaN(hi)) return false;
      if (lo < min || hi > max || lo > hi) return false;
    } else {
      const value = Number.parseInt(token, 10);
      if (Number.isNaN(value)) return false;
      if (value < min || value > max) return false;
    }
  }
  return true;
}
