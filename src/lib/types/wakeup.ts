export type ScheduleMode = "interval" | "daily" | "custom";
export type TriggerSource = "manual" | "scheduled" | "quota_reset";

export interface WakeupConfig {
  enabled: boolean;
  selectedModels: string[];
  selectedAccountIds: string[];
  scheduleMode: ScheduleMode;
  intervalHours: number;
  dailyTimes: string[];
  cronExpression: string | null;
  customPrompt: string;
  maxOutputTokens: number;
  cooldownMinutes: number;
  wakeOnReset: boolean;
}

export const SCHEDULE_MODES: ScheduleMode[] = ["interval", "daily", "custom"];

export const AVAILABLE_WAKEUP_MODELS: { id: string; label: string }[] = [
  { id: "claude-sonnet-4-5", label: "Claude Sonnet 4.5" },
  { id: "gemini-3-flash", label: "Gemini 3 Flash" },
  { id: "gemini-3-pro-low", label: "Gemini 3 Pro (Low)" },
];

export const DEFAULT_WAKEUP_CONFIG: WakeupConfig = {
  enabled: false,
  selectedModels: AVAILABLE_WAKEUP_MODELS.map((m) => m.id),
  selectedAccountIds: [],
  scheduleMode: "interval",
  intervalHours: 6,
  dailyTimes: ["09:00", "15:00", "21:00"],
  cronExpression: null,
  customPrompt: "hi",
  maxOutputTokens: 1,
  cooldownMinutes: 60,
  wakeOnReset: false,
};

export interface CronValidationResult {
  valid: boolean;
  error?: string;
}

const CRON_FIELD_RANGE: { min: number; max: number }[] = [
  { min: 0, max: 59 }, // minute
  { min: 0, max: 23 }, // hour
  { min: 1, max: 31 }, // day of month
  { min: 1, max: 12 }, // month
  { min: 0, max: 7 }, // day of week (0 and 7 both = Sunday)
];

const MAX_CRON_LENGTH = 100;
const MAX_CRON_FIELD_LENGTH = 20;

/**
 * Validates a single cron atom: "*", a number, a range "a-b", or any of those
 * optionally followed by a "/step". Rejects malformed input such as multiple
 * dashes (`1-2-3`), a leading dash (`-5`), empty parts, non-integer values, or
 * out-of-range numbers. This prevents storing cron data that a downstream
 * scheduler cannot safely interpret.
 */
function validateCronAtom(
  atom: string,
  range: { min: number; max: number },
): boolean {
  if (atom === "*") return true;

  let base = atom;
  if (atom.includes("/")) {
    const parts = atom.split("/");
    if (parts.length !== 2) return false;
    base = parts[0];
    const step = Number(parts[1]);
    if (!Number.isInteger(step) || step < 1) return false;
  }

  if (base === "*") return true;

  if (base.includes("-")) {
    const bounds = base.split("-");
    if (bounds.length !== 2) return false;
    const lo = Number(bounds[0]);
    const hi = Number(bounds[1]);
    return (
      Number.isInteger(lo) &&
      Number.isInteger(hi) &&
      lo >= range.min &&
      hi <= range.max &&
      lo <= hi
    );
  }

  const value = Number(base);
  return Number.isInteger(value) && value >= range.min && value <= range.max;
}

function validateCronField(
  field: string,
  range: { min: number; max: number },
): boolean {
  if (field.length === 0 || field.length > MAX_CRON_FIELD_LENGTH) return false;
  // A field is a comma-separated list of atoms.
  return field.split(",").every((atom) => validateCronAtom(atom, range));
}

/**
 * Validates a standard 5-field cron expression (minute hour day-of-month month
 * day-of-week). Returns a human-readable error when invalid.
 */
export function validateCronExpression(
  expression: string,
): CronValidationResult {
  if (typeof expression !== "string") {
    return { valid: false, error: "Cron expression must be a string." };
  }

  const trimmed = expression.trim();
  if (!trimmed) {
    return { valid: false, error: "Cron expression is required." };
  }

  if (trimmed.length > MAX_CRON_LENGTH) {
    return {
      valid: false,
      error: `Cron expression must be at most ${MAX_CRON_LENGTH} characters.`,
    };
  }

  const fields = trimmed.split(/\s+/);
  if (fields.length !== 5) {
    return {
      valid: false,
      error:
        "Cron expression must have exactly 5 fields (minute hour day month weekday).",
    };
  }

  for (let i = 0; i < fields.length; i += 1) {
    if (!validateCronField(fields[i], CRON_FIELD_RANGE[i])) {
      const names = ["minute", "hour", "day-of-month", "month", "day-of-week"];
      return {
        valid: false,
        error: `Invalid ${names[i]} field: "${fields[i]}".`,
      };
    }
  }

  return { valid: true };
}

/**
 * Validates a 24-hour HH:MM time string.
 */
export function validateDailyTime(value: string): boolean {
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
}
