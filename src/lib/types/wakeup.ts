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

// Steps allowed: `*/15`, `1-5/2`, `5/2`.
const STEP_RE = /^(\*|\d+(?:-\d+)?)\/(\d+)$/;

function validateCronField(
  field: string,
  range: { min: number; max: number },
): boolean {
  if (field === "*") return true;

  if (field.includes("/")) {
    const match = field.match(STEP_RE);
    if (!match) return false;
    const base = match[1];
    const step = Number(match[2]);
    if (step < 1) return false;
    if (base === "*") return true;
    // base is either a number or a range like 1-5
    const [loStr, hiStr] = base.split("-");
    const lo = Number(loStr);
    const hi = hiStr ? Number(hiStr) : lo;
    return (
      Number.isInteger(lo) && lo >= range.min && hi <= range.max && lo <= hi
    );
  }

  for (const part of field.split(",")) {
    if (part.includes("-")) {
      const [loStr, hiStr] = part.split("-");
      const lo = Number(loStr);
      const hi = Number(hiStr);
      if (
        !Number.isInteger(lo) ||
        !Number.isInteger(hi) ||
        lo < range.min ||
        hi > range.max ||
        lo > hi
      ) {
        return false;
      }
    } else {
      const value = Number(part);
      if (!Number.isInteger(value) || value < range.min || value > range.max) {
        return false;
      }
    }
  }
  return true;
}

/**
 * Validates a standard 5-field cron expression (minute hour day-of-month month
 * day-of-week). Returns a human-readable error when invalid.
 */
export function validateCronExpression(
  expression: string,
): CronValidationResult {
  const trimmed = expression.trim();
  if (!trimmed) {
    return { valid: false, error: "Cron expression is required." };
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
