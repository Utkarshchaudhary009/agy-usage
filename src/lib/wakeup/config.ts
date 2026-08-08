import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/types/database";
import type { WakeupConfig, WakeupConfigInput } from "@/lib/types/wakeup";
import { isWakeupModelId } from "./models";
import { isDailyTime, isValidCronExpression } from "./schedule-evaluator";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const DEFAULT_WAKEUP_CONFIG: WakeupConfigInput = {
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

type Row = Database["public"]["Tables"]["wakeup_configs"]["Row"];

function rowToConfig(row: Row): WakeupConfig {
  return {
    id: row.id,
    clerkUserId: row.clerk_user_id,
    enabled: row.enabled,
    selectedModels: row.selected_models,
    selectedAccountIds: row.selected_account_ids,
    scheduleMode: row.schedule_mode,
    intervalHours: row.interval_hours,
    dailyTimes: row.daily_times,
    cronExpression: row.cron_expression,
    customPrompt: row.custom_prompt,
    maxOutputTokens: row.max_output_tokens,
    cooldownMinutes: row.cooldown_minutes,
    wakeOnReset: row.wake_on_reset,
    updatedAt: row.updated_at,
  };
}

export async function getWakeupConfig(
  supabase: SupabaseClient<Database>,
  userId: string,
): Promise<WakeupConfig | null> {
  const { data, error } = await supabase
    .from("wakeup_configs")
    .select("*")
    .eq("clerk_user_id", userId)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to load wakeup config: ${error.message}`);
  }
  return data ? rowToConfig(data) : null;
}

export type SaveConfigResult =
  | { ok: true; config: WakeupConfig }
  | { ok: false; error: string; code: string };

export function validateWakeupConfig(
  input: unknown,
  ownedAccountIds: Set<string>,
):
  | { ok: true; value: WakeupConfigInput }
  | { ok: false; error: string; code: string } {
  if (typeof input !== "object" || input === null) {
    return {
      ok: false,
      error: "Request body must be an object",
      code: "INVALID_BODY",
    };
  }
  const raw = input as Record<string, unknown>;

  const enabled = Boolean(raw.enabled);
  const wakeOnReset = Boolean(raw.wakeOnReset);

  if (!Array.isArray(raw.selectedModels) || raw.selectedModels.length === 0) {
    return {
      ok: false,
      error: "Select at least one model to wake up.",
      code: "NO_MODELS",
    };
  }
  const selectedModels = raw.selectedModels.filter(
    (m): m is string => typeof m === "string" && isWakeupModelId(m),
  );
  if (selectedModels.length === 0) {
    return {
      ok: false,
      error: "One or more selected models are invalid.",
      code: "INVALID_MODELS",
    };
  }

  if (!Array.isArray(raw.selectedAccountIds)) {
    return {
      ok: false,
      error: "selectedAccountIds must be an array.",
      code: "INVALID_ACCOUNTS",
    };
  }
  const selectedAccountIds: string[] = [];
  for (const id of raw.selectedAccountIds) {
    if (typeof id !== "string" || !UUID_RE.test(id)) {
      return {
        ok: false,
        error: "One or more account IDs are invalid.",
        code: "INVALID_ACCOUNTS",
      };
    }
    if (!ownedAccountIds.has(id)) {
      return {
        ok: false,
        error: "You can only target accounts you own.",
        code: "ACCOUNT_NOT_OWNED",
      };
    }
    selectedAccountIds.push(id);
  }

  const scheduleMode = raw.scheduleMode;
  if (
    scheduleMode !== "interval" &&
    scheduleMode !== "daily" &&
    scheduleMode !== "custom"
  ) {
    return {
      ok: false,
      error: "scheduleMode must be interval, daily, or custom.",
      code: "INVALID_SCHEDULE_MODE",
    };
  }

  const intervalHours = Number.parseInt(String(raw.intervalHours), 10);
  if (
    !Number.isInteger(intervalHours) ||
    intervalHours < 1 ||
    intervalHours > 24
  ) {
    return {
      ok: false,
      error: "intervalHours must be an integer between 1 and 24.",
      code: "INVALID_INTERVAL",
    };
  }

  if (!Array.isArray(raw.dailyTimes) || raw.dailyTimes.length === 0) {
    return {
      ok: false,
      error: "dailyTimes must contain at least one time.",
      code: "INVALID_DAILY_TIMES",
    };
  }
  const dailyTimes = raw.dailyTimes.filter(
    (t): t is string => typeof t === "string" && isDailyTime(t),
  );
  if (dailyTimes.length === 0) {
    return {
      ok: false,
      error: "Every daily time must be in HH:MM (24h) format.",
      code: "INVALID_DAILY_TIMES",
    };
  }

  let cronExpression: string | null = null;
  if (scheduleMode === "custom") {
    const expr =
      typeof raw.cronExpression === "string" ? raw.cronExpression.trim() : "";
    if (!expr) {
      return {
        ok: false,
        error: "A cron expression is required in custom mode.",
        code: "MISSING_CRON",
      };
    }
    if (!isValidCronExpression(expr)) {
      return {
        ok: false,
        error:
          "Invalid cron expression. Use 5 fields: minute hour day-of-month month day-of-week.",
        code: "INVALID_CRON",
      };
    }
    cronExpression = expr;
  }

  const customPrompt =
    typeof raw.customPrompt === "string" ? raw.customPrompt : "";
  if (customPrompt.trim().length === 0) {
    return {
      ok: false,
      error: "customPrompt cannot be empty.",
      code: "INVALID_PROMPT",
    };
  }
  if (customPrompt.length > 1000) {
    return {
      ok: false,
      error: "customPrompt must be 1000 characters or fewer.",
      code: "INVALID_PROMPT",
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
      error: "maxOutputTokens must be an integer between 1 and 8192.",
      code: "INVALID_MAX_TOKENS",
    };
  }

  const cooldownMinutes = Number.parseInt(String(raw.cooldownMinutes), 10);
  if (
    !Number.isInteger(cooldownMinutes) ||
    cooldownMinutes < 1 ||
    cooldownMinutes > 1440
  ) {
    return {
      ok: false,
      error: "cooldownMinutes must be an integer between 1 and 1440.",
      code: "INVALID_COOLDOWN",
    };
  }

  return {
    ok: true,
    value: {
      enabled,
      selectedModels,
      selectedAccountIds,
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

export async function saveWakeupConfig(
  supabase: SupabaseClient<Database>,
  userId: string,
  input: unknown,
  ownedAccountIds: Set<string>,
): Promise<SaveConfigResult> {
  const validation = validateWakeupConfig(input, ownedAccountIds);
  if (!validation.ok) return validation;

  const v = validation.value;
  const { error } = await supabase.from("wakeup_configs").upsert(
    {
      clerk_user_id: userId,
      enabled: v.enabled,
      selected_models: v.selectedModels,
      selected_account_ids: v.selectedAccountIds,
      schedule_mode: v.scheduleMode,
      interval_hours: v.intervalHours,
      daily_times: v.dailyTimes,
      cron_expression: v.cronExpression,
      custom_prompt: v.customPrompt,
      max_output_tokens: v.maxOutputTokens,
      cooldown_minutes: v.cooldownMinutes,
      wake_on_reset: v.wakeOnReset,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "clerk_user_id" },
  );

  if (error) {
    return {
      ok: false,
      error: `Failed to save config: ${error.message}`,
      code: "SAVE_FAILED",
    };
  }

  const config = await getWakeupConfig(supabase, userId);
  if (!config) {
    return {
      ok: false,
      error: "Config saved but could not be read back.",
      code: "SAVE_FAILED",
    };
  }
  return { ok: true, config };
}
