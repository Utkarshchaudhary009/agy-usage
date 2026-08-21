import "server-only";

import type { ScheduleMode, WakeupConfig } from "@/lib/types/wakeup";
import {
  DEFAULT_WAKEUP_CONFIG,
  UUID_RE,
  WAKEUP_MODEL_IDS,
} from "@/lib/types/wakeup";
import { DAILY_TIME_RE, isValidCronExpression } from "./schedule";

const SCHEDULE_MODES: ScheduleMode[] = ["interval", "daily", "custom"];

// Columns selected when reading a wakeup config. Kept in one place so the page
// loader, the GET route, and dbRowToWakeupConfig never drift apart. Defined as a
// string-literal (not a runtime-built string) so supabase-js can still infer the
// row shape from the `.select()` argument.
export const WAKEUP_CONFIG_SELECT =
  "enabled, selected_models, selected_account_ids, schedule_mode, interval_hours, daily_times, cron_expression, custom_prompt, max_output_tokens, cooldown_minutes, wake_on_reset";

export type ValidationResult =
  | { ok: true; config: WakeupConfig }
  | { ok: false; error: string; field?: string };

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string");
}

function clampInt(value: unknown, min: number, max: number): number | null {
  // Only whole numbers are accepted. A fractional or coercible string (e.g.
  // "1.5" or "1.0") must be rejected rather than silently floored, otherwise
  // the stored setting silently differs from what the user entered.
  if (
    (typeof value !== "number" && typeof value !== "string") ||
    (typeof value === "string" && value.trim() === "")
  ) {
    return null;
  }
  const number = Number(value);
  if (!Number.isFinite(number) || !Number.isInteger(number)) return null;
  if (number < min || number > max) return null;
  return number;
}

// Validates and normalizes an untrusted payload into a complete WakeupConfig.
// Unknown or out-of-range fields fall back to the defaults rather than failing,
// except where a value is required (at least one model, valid cron, etc.).
export function validateWakeupConfig(input: unknown): ValidationResult {
  if (typeof input !== "object" || input === null) {
    return { ok: false, error: "Invalid configuration payload." };
  }
  const raw = input as Record<string, unknown>;
  const config: WakeupConfig = { ...DEFAULT_WAKEUP_CONFIG };

  config.enabled = raw.enabled === true;

  const selectedModels = [...new Set(asStringArray(raw.selectedModels))].filter(
    (model) => WAKEUP_MODEL_IDS.includes(model),
  );
  if (selectedModels.length === 0) {
    return {
      ok: false,
      error: "Select at least one model to wake up.",
      field: "selectedModels",
    };
  }
  config.selectedModels = selectedModels;

  config.selectedAccountIds = asStringArray(raw.selectedAccountIds).filter(
    (id) => UUID_RE.test(id),
  );

  const scheduleMode = raw.scheduleMode;
  if (
    typeof scheduleMode !== "string" ||
    !SCHEDULE_MODES.includes(scheduleMode as ScheduleMode)
  ) {
    return {
      ok: false,
      error: "Invalid schedule mode.",
      field: "scheduleMode",
    };
  }
  config.scheduleMode = scheduleMode as ScheduleMode;

  const intervalHours = clampInt(raw.intervalHours, 1, 168);
  if (intervalHours === null) {
    return {
      ok: false,
      error: "Interval must be a whole number of hours between 1 and 168.",
      field: "intervalHours",
    };
  }
  config.intervalHours = intervalHours;

  if (config.scheduleMode === "daily") {
    const dailyTimes = asStringArray(raw.dailyTimes).filter((time) =>
      DAILY_TIME_RE.test(time),
    );
    if (dailyTimes.length === 0) {
      return {
        ok: false,
        error: "Add at least one valid daily time (HH:MM).",
        field: "dailyTimes",
      };
    }
    config.dailyTimes = dailyTimes;
  }

  if (config.scheduleMode === "custom") {
    const cronExpression =
      typeof raw.cronExpression === "string" ? raw.cronExpression.trim() : "";
    if (!isValidCronExpression(cronExpression)) {
      return {
        ok: false,
        error: "Enter a valid 5-field cron expression (e.g. '0 */6 * * *').",
        field: "cronExpression",
      };
    }
    config.cronExpression = cronExpression;
  }

  if (typeof raw.customPrompt === "string" && raw.customPrompt.length > 0) {
    config.customPrompt = raw.customPrompt.slice(0, 2000);
  }

  const maxOutputTokens = clampInt(raw.maxOutputTokens, 1, 8192);
  if (maxOutputTokens === null) {
    return {
      ok: false,
      error: "Max output tokens must be a whole number between 1 and 8192.",
      field: "maxOutputTokens",
    };
  }
  config.maxOutputTokens = maxOutputTokens;

  const cooldownMinutes = clampInt(raw.cooldownMinutes, 0, 1440);
  if (cooldownMinutes === null) {
    return {
      ok: false,
      error: "Cooldown must be a whole number of minutes between 0 and 1440.",
      field: "cooldownMinutes",
    };
  }
  config.cooldownMinutes = cooldownMinutes;

  config.wakeOnReset = raw.wakeOnReset === true;

  return { ok: true, config };
}

interface WakeupConfigRow {
  enabled: boolean;
  selected_models: string[];
  selected_account_ids: string[];
  schedule_mode: ScheduleMode;
  interval_hours: number;
  daily_times: string[];
  cron_expression: string | null;
  custom_prompt: string;
  max_output_tokens: number;
  cooldown_minutes: number;
  wake_on_reset: boolean;
}

export function dbRowToWakeupConfig(row: WakeupConfigRow): WakeupConfig {
  return {
    enabled: row.enabled,
    selectedModels: row.selected_models ?? DEFAULT_WAKEUP_CONFIG.selectedModels,
    selectedAccountIds: row.selected_account_ids ?? [],
    scheduleMode: row.schedule_mode,
    intervalHours: row.interval_hours,
    dailyTimes: row.daily_times ?? DEFAULT_WAKEUP_CONFIG.dailyTimes,
    cronExpression: row.cron_expression,
    customPrompt: row.custom_prompt,
    maxOutputTokens: row.max_output_tokens,
    cooldownMinutes: row.cooldown_minutes,
    wakeOnReset: row.wake_on_reset,
  };
}
