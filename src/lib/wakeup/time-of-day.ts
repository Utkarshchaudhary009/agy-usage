/**
 * Time-of-day parsing for the "daily" schedule mode.
 *
 * One regex, one parser: the form, the server-side validator and the schedule
 * evaluator all go through here, so a value can never be accepted by one and
 * re-interpreted (or rejected) by another. `new Date(...)` is deliberately not
 * used for parsing — it happily rolls "25:70" over into the next day.
 */

const TIME_OF_DAY_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

export interface TimeOfDay {
  hours: number;
  minutes: number;
}

export function parseTimeOfDay(value: string): TimeOfDay | null {
  const match = TIME_OF_DAY_RE.exec(value);
  if (!match) return null;
  return { hours: Number(match[1]), minutes: Number(match[2]) };
}

export function isValidTimeOfDay(value: string): boolean {
  return TIME_OF_DAY_RE.test(value);
}

export function formatTimeOfDay({ hours, minutes }: TimeOfDay): string {
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}
