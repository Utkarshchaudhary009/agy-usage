import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/types/database";
import {
  AVAILABLE_WAKEUP_MODELS,
  DEFAULT_WAKEUP_CONFIG,
  SCHEDULE_MODES,
  type ScheduleMode,
  validateCronExpression,
  validateDailyTime,
  type WakeupConfig,
} from "@/lib/types/wakeup";

// Defensive caps to prevent resource exhaustion from an oversized request body.
const MAX_MODELS = 50;
const MAX_ACCOUNTS = 200;
const MAX_DAILY_TIMES = 100;

const ALLOWED_MODEL_IDS = new Set(AVAILABLE_WAKEUP_MODELS.map((m) => m.id));

export type ConfigRow = Database["public"]["Tables"]["wakeup_configs"]["Row"];

type ConfigInsert = Database["public"]["Tables"]["wakeup_configs"]["Insert"];

export function rowToConfig(row: ConfigRow): WakeupConfig {
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

export function configToInsert(
  config: WakeupConfig,
  clerkUserId: string,
): ConfigInsert {
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
  };
}

export interface ConfigValidationResult {
  valid: boolean;
  error?: string;
  config?: WakeupConfig;
}

function asBoolean(value: unknown): boolean | undefined {
  if (typeof value === "boolean") return value;
  return undefined;
}

function asStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  if (!value.every((v) => typeof v === "string")) return undefined;
  return value as string[];
}

function asString(value: unknown): string | undefined {
  if (typeof value === "string") return value;
  return undefined;
}

function asPositiveInt(value: unknown, max: number): number | undefined {
  if (typeof value !== "number" || !Number.isInteger(value)) return undefined;
  if (value < 1 || value > max) return undefined;
  return value;
}

/**
 * Validates an untrusted PUT body and produces a normalized WakeupConfig.
 * Structural validation only — account ownership is enforced atomically inside
 * the `save_wakeup_config` RPC so the check cannot race with account removal.
 */
export function validateWakeupConfig(input: unknown): ConfigValidationResult {
  if (typeof input !== "object" || input === null) {
    return { valid: false, error: "Invalid request body." };
  }
  const raw = input as Record<string, unknown>;

  const enabled = asBoolean(raw.enabled);
  if (enabled === undefined) {
    return { valid: false, error: "`enabled` must be a boolean." };
  }

  const selectedModels = asStringArray(raw.selectedModels);
  if (!selectedModels) {
    return {
      valid: false,
      error: "`selectedModels` must be an array of strings.",
    };
  }
  if (selectedModels.length > MAX_MODELS) {
    return {
      valid: false,
      error: `\`selectedModels\` must contain at most ${MAX_MODELS} entries.`,
    };
  }
  // Only accept known model identifiers; reject arbitrary strings that could be
  // forwarded to downstream model APIs.
  const uniqueModels = [...new Set(selectedModels)];
  for (const model of uniqueModels) {
    if (!ALLOWED_MODEL_IDS.has(model)) {
      return {
        valid: false,
        error: `"${model}" is not a supported model.`,
      };
    }
  }

  const selectedAccountIds = asStringArray(raw.selectedAccountIds);
  if (!selectedAccountIds) {
    return {
      valid: false,
      error: "`selectedAccountIds` must be an array of strings.",
    };
  }
  if (selectedAccountIds.length > MAX_ACCOUNTS) {
    return {
      valid: false,
      error: `\`selectedAccountIds\` must contain at most ${MAX_ACCOUNTS} entries.`,
    };
  }
  const uniqueAccountIds = [...new Set(selectedAccountIds)];

  const scheduleModeRaw = asString(raw.scheduleMode);
  if (
    !scheduleModeRaw ||
    !SCHEDULE_MODES.includes(scheduleModeRaw as ScheduleMode)
  ) {
    return {
      valid: false,
      error: "`scheduleMode` must be one of: interval, daily, custom.",
    };
  }
  const scheduleMode = scheduleModeRaw as ScheduleMode;

  // Mode-relevant fields are validated only when they apply. Unused fields for
  // the active mode fall back to a safe value so the stored config stays
  // complete without rejecting otherwise-valid requests.
  let intervalHours = DEFAULT_WAKEUP_CONFIG.intervalHours;
  if (scheduleMode === "interval") {
    const value = asPositiveInt(raw.intervalHours, 168);
    if (value === undefined) {
      return {
        valid: false,
        error: "`intervalHours` must be an integer between 1 and 168.",
      };
    }
    intervalHours = value;
  } else if (raw.intervalHours !== undefined) {
    const value = asPositiveInt(raw.intervalHours, 168);
    if (value !== undefined) intervalHours = value;
  }

  let dailyTimes: string[] = [];
  if (scheduleMode === "daily") {
    const times = asStringArray(raw.dailyTimes);
    if (!times || times.length === 0) {
      return {
        valid: false,
        error: "`dailyTimes` must be a non-empty array of HH:MM strings.",
      };
    }
    if (times.length > MAX_DAILY_TIMES) {
      return {
        valid: false,
        error: `\`dailyTimes\` must contain at most ${MAX_DAILY_TIMES} entries.`,
      };
    }
    for (const time of times) {
      if (!validateDailyTime(time)) {
        return {
          valid: false,
          error: `"${time}" is not a valid 24-hour time (expected HH:MM).`,
        };
      }
    }
    dailyTimes = times;
  } else if (raw.dailyTimes !== undefined) {
    const times = asStringArray(raw.dailyTimes);
    if (times) dailyTimes = times.filter(validateDailyTime);
  }

  let cronExpression: string | null = null;
  if (scheduleMode === "custom") {
    const cronRaw = asString(raw.cronExpression);
    if (!cronRaw) {
      return {
        valid: false,
        error: "`cronExpression` is required when scheduleMode is custom.",
      };
    }
    const result = validateCronExpression(cronRaw);
    if (!result.valid) {
      return { valid: false, error: result.error };
    }
    cronExpression = cronRaw;
  }

  const customPrompt = asString(raw.customPrompt);
  if (!customPrompt || customPrompt.trim().length === 0) {
    return {
      valid: false,
      error: "`customPrompt` must be a non-empty string.",
    };
  }
  if (customPrompt.length > 2000) {
    return {
      valid: false,
      error: "`customPrompt` must be at most 2000 characters.",
    };
  }

  const maxOutputTokens = asPositiveInt(raw.maxOutputTokens, 4096);
  if (maxOutputTokens === undefined) {
    return {
      valid: false,
      error: "`maxOutputTokens` must be an integer between 1 and 4096.",
    };
  }

  const cooldownMinutes = asPositiveInt(raw.cooldownMinutes, 1440);
  if (cooldownMinutes === undefined) {
    return {
      valid: false,
      error: "`cooldownMinutes` must be an integer between 1 and 1440.",
    };
  }

  const wakeOnReset = asBoolean(raw.wakeOnReset);
  if (wakeOnReset === undefined) {
    return { valid: false, error: "`wakeOnReset` must be a boolean." };
  }

  return {
    valid: true,
    config: {
      enabled,
      selectedModels: uniqueModels,
      selectedAccountIds: uniqueAccountIds,
      scheduleMode,
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

/**
 * Loads a user's wakeup config or returns the default when none exists yet.
 */
export async function loadWakeupConfig(
  supabase: SupabaseClient<Database>,
  clerkUserId: string,
): Promise<WakeupConfig> {
  const { data, error } = await supabase
    .from("wakeup_configs")
    .select("*")
    .eq("clerk_user_id", clerkUserId)
    .maybeSingle();

  if (error) {
    console.error("Failed to load wakeup config:", error);
    throw error;
  }

  if (!data) return DEFAULT_WAKEUP_CONFIG;
  return rowToConfig(data);
}
