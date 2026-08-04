import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/types/database";
import {
  DEFAULT_WAKEUP_CONFIG,
  type WakeupConfig,
  type WakeupConfigInput,
} from "@/lib/types/wakeup";

type WakeupConfigRow = Database["public"]["Tables"]["wakeup_configs"]["Row"];

/** Columns `mapRowToConfig` needs; `id` is deliberately never sent to clients. */
const CONFIG_COLUMNS =
  "enabled, selected_models, selected_account_ids, schedule_mode, interval_hours, daily_times, cron_expression, custom_prompt, max_output_tokens, cooldown_minutes, wake_on_reset, updated_at";

/** Maps a database row (snake_case) to the API/UI shape (camelCase). */
export function mapRowToConfig(
  row: Omit<WakeupConfigRow, "id" | "clerk_user_id">,
): WakeupConfig {
  return {
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

/** Fresh copy of the defaults: the arrays must never be shared across requests. */
function defaultConfig(): WakeupConfig {
  return {
    ...DEFAULT_WAKEUP_CONFIG,
    selectedModels: [...DEFAULT_WAKEUP_CONFIG.selectedModels],
    selectedAccountIds: [...DEFAULT_WAKEUP_CONFIG.selectedAccountIds],
    dailyTimes: [...DEFAULT_WAKEUP_CONFIG.dailyTimes],
  };
}

/**
 * Loads the caller's configuration. Returns the defaults (with a null
 * `updatedAt`) when the user has never saved one, so callers never have to
 * special-case a missing row.
 *
 * Throws on an unexpected database error; a missing row is not an error.
 */
export async function getWakeupConfig(
  supabase: SupabaseClient<Database>,
  clerkUserId: string,
): Promise<WakeupConfig> {
  const { data, error } = await supabase
    .from("wakeup_configs")
    .select(CONFIG_COLUMNS)
    .eq("clerk_user_id", clerkUserId)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to load wakeup config: ${error.message}`);
  }
  if (!data) return defaultConfig();

  return mapRowToConfig(data);
}

/**
 * Creates or replaces the caller's configuration.
 *
 * `clerk_user_id` is taken from the authenticated session (never the request
 * body) and `wakeup_configs.clerk_user_id` is UNIQUE, so the upsert can only
 * ever touch the caller's own row.
 */
export async function saveWakeupConfig(
  supabase: SupabaseClient<Database>,
  clerkUserId: string,
  input: WakeupConfigInput,
): Promise<WakeupConfig> {
  const { data, error } = await supabase
    .from("wakeup_configs")
    .upsert(
      {
        clerk_user_id: clerkUserId,
        enabled: input.enabled,
        selected_models: input.selectedModels,
        selected_account_ids: input.selectedAccountIds,
        schedule_mode: input.scheduleMode,
        interval_hours: input.intervalHours,
        daily_times: input.dailyTimes,
        cron_expression: input.cronExpression,
        custom_prompt: input.customPrompt,
        max_output_tokens: input.maxOutputTokens,
        cooldown_minutes: input.cooldownMinutes,
        wake_on_reset: input.wakeOnReset,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "clerk_user_id" },
    )
    .select(CONFIG_COLUMNS)
    .single();

  if (error) {
    throw new Error(`Failed to save wakeup config: ${error.message}`);
  }

  return mapRowToConfig(data);
}
