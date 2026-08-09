import type { Database } from "./database";

export type ScheduleMode = "interval" | "daily" | "custom";

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

export const WAKEUP_MODEL_OPTIONS: ReadonlyArray<{
  id: string;
  label: string;
  provider: "ANTHROPIC" | "GOOGLE";
}> = [
  {
    id: "claude-sonnet-4-5",
    label: "Claude Sonnet 4.5",
    provider: "ANTHROPIC",
  },
  { id: "gemini-3-flash", label: "Gemini 3 Flash", provider: "GOOGLE" },
  { id: "gemini-3-pro-low", label: "Gemini 3 Pro (Low)", provider: "GOOGLE" },
];

export const DEFAULT_WAKEUP_CONFIG: WakeupConfig = {
  enabled: false,
  selectedModels: ["claude-sonnet-4-5", "gemini-3-flash", "gemini-3-pro-low"],
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

export type WakeupConfigRow =
  Database["public"]["Tables"]["wakeup_configs"]["Row"];
export type WakeupConfigInsert =
  Database["public"]["Tables"]["wakeup_configs"]["Insert"];

export function dbConfigToWakeup(row: WakeupConfigRow): WakeupConfig {
  return {
    enabled: row.enabled,
    selectedModels: row.selected_models ?? [],
    selectedAccountIds: row.selected_account_ids ?? [],
    scheduleMode: row.schedule_mode,
    intervalHours: row.interval_hours,
    dailyTimes: row.daily_times ?? [],
    cronExpression: row.cron_expression,
    customPrompt: row.custom_prompt,
    maxOutputTokens: row.max_output_tokens,
    cooldownMinutes: row.cooldown_minutes,
    wakeOnReset: row.wake_on_reset,
  };
}

export function wakeupConfigToDb(
  config: WakeupConfig,
  clerkUserId: string,
): WakeupConfigInsert {
  return {
    clerk_user_id: clerkUserId,
    enabled: config.enabled,
    selected_models: config.selectedModels,
    selected_account_ids: config.selectedAccountIds,
    schedule_mode: config.scheduleMode,
    interval_hours: config.intervalHours,
    daily_times: config.dailyTimes,
    cron_expression: config.cronExpression,
    custom_prompt: config.customPrompt,
    max_output_tokens: config.maxOutputTokens,
    cooldown_minutes: config.cooldownMinutes,
    wake_on_reset: config.wakeOnReset,
    updated_at: new Date().toISOString(),
  };
}

const SCHEDULE_MODES: ScheduleMode[] = ["interval", "daily", "custom"];
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

export type ValidationResult =
  | { ok: true; config: WakeupConfig }
  | { ok: false; error: string };

/**
 * Validates and normalizes an untrusted payload into a `WakeupConfig`.
 * Returns a single, human-readable error message on the first failure.
 */
export function validateWakeupConfig(input: unknown): ValidationResult {
  if (typeof input !== "object" || input === null) {
    return { ok: false, error: "Invalid request body." };
  }
  const raw = input as Record<string, unknown>;

  const enabled = Boolean(raw.enabled);
  const wakeOnReset = Boolean(raw.wakeOnReset);

  const selectedModels = normalizeStringArray(raw.selectedModels);
  if (selectedModels.some((m) => m.length === 0)) {
    return { ok: false, error: "Model IDs must be non-empty." };
  }

  const selectedAccountIds = normalizeStringArray(raw.selectedAccountIds);
  if (selectedAccountIds.some((id) => !isUuid(id))) {
    return { ok: false, error: "Selected accounts contain an invalid ID." };
  }

  const scheduleMode = raw.scheduleMode;
  if (
    typeof scheduleMode !== "string" ||
    !SCHEDULE_MODES.includes(scheduleMode as ScheduleMode)
  ) {
    return {
      ok: false,
      error: "Schedule mode must be 'interval', 'daily', or 'custom'.",
    };
  }

  const intervalHours = Number.parseInt(String(raw.intervalHours), 10);
  if (
    !Number.isInteger(intervalHours) ||
    intervalHours < 1 ||
    intervalHours > 168
  ) {
    return {
      ok: false,
      error: "Interval must be a whole number between 1 and 168 hours.",
    };
  }

  const dailyTimes = normalizeStringArray(raw.dailyTimes);
  if (dailyTimes.some((t) => !TIME_RE.test(t))) {
    return { ok: false, error: "Daily times must use the 24h HH:MM format." };
  }

  let cronExpression: string | null = null;
  if (scheduleMode === "custom") {
    const expr =
      typeof raw.cronExpression === "string" ? raw.cronExpression.trim() : "";
    if (!expr) {
      return {
        ok: false,
        error: "A cron expression is required in custom mode.",
      };
    }
    cronExpression = expr;
  }

  const customPrompt =
    typeof raw.customPrompt === "string" ? raw.customPrompt : "";
  if (customPrompt.trim().length === 0) {
    return { ok: false, error: "The wakeup prompt cannot be empty." };
  }
  if (customPrompt.length > 2000) {
    return {
      ok: false,
      error: "The wakeup prompt is too long (max 2000 characters).",
    };
  }

  const maxOutputTokens = Number.parseInt(String(raw.maxOutputTokens), 10);
  if (
    !Number.isInteger(maxOutputTokens) ||
    maxOutputTokens < 1 ||
    maxOutputTokens > 8192
  ) {
    return {
      ok: false,
      error: "Max output tokens must be between 1 and 8192.",
    };
  }

  const cooldownMinutes = Number.parseInt(String(raw.cooldownMinutes), 10);
  if (
    !Number.isInteger(cooldownMinutes) ||
    cooldownMinutes < 0 ||
    cooldownMinutes > 1440
  ) {
    return { ok: false, error: "Cooldown must be between 0 and 1440 minutes." };
  }

  return {
    ok: true,
    config: {
      enabled,
      selectedModels,
      selectedAccountIds,
      scheduleMode: scheduleMode as ScheduleMode,
      intervalHours,
      dailyTimes,
      cronExpression,
      customPrompt,
      maxOutputTokens,
      cooldownMinutes,
      wakeOnReset,
    },
  };
}

function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((v): v is string => typeof v === "string")
    .map((v) => v.trim());
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
    value,
  );
}
