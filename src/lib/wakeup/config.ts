import "server-only";
import { auth } from "@clerk/nextjs/server";
import { createServerClient } from "@/lib/supabase/server";
import { DEFAULT_WAKEUP_CONFIG, type WakeupConfig } from "@/lib/types/wakeup";

type DbWakeupConfig = {
  enabled: boolean;
  selected_models: string[] | null;
  selected_account_ids: string[] | null;
  schedule_mode: "interval" | "daily" | "custom";
  interval_hours: number | null;
  daily_times: string[] | null;
  cron_expression: string | null;
  custom_prompt: string | null;
  max_output_tokens: number | null;
  cooldown_minutes: number | null;
  wake_on_reset: boolean | null;
};

function fromDb(row: DbWakeupConfig): WakeupConfig {
  return {
    enabled: row.enabled,
    selectedModels: row.selected_models ?? DEFAULT_WAKEUP_CONFIG.selectedModels,
    selectedAccountIds: row.selected_account_ids ?? [],
    scheduleMode: row.schedule_mode,
    intervalHours: row.interval_hours ?? DEFAULT_WAKEUP_CONFIG.intervalHours,
    dailyTimes: row.daily_times ?? DEFAULT_WAKEUP_CONFIG.dailyTimes,
    cronExpression: row.cron_expression,
    customPrompt: row.custom_prompt ?? DEFAULT_WAKEUP_CONFIG.customPrompt,
    maxOutputTokens:
      row.max_output_tokens ?? DEFAULT_WAKEUP_CONFIG.maxOutputTokens,
    cooldownMinutes:
      row.cooldown_minutes ?? DEFAULT_WAKEUP_CONFIG.cooldownMinutes,
    wakeOnReset: row.wake_on_reset ?? DEFAULT_WAKEUP_CONFIG.wakeOnReset,
  };
}

// Loads the current user's wakeup config, returning defaults when none exists
// yet (so the form always has a populated starting state).
export async function getWakeupConfig(): Promise<WakeupConfig> {
  const { userId } = await auth();
  if (!userId) return DEFAULT_WAKEUP_CONFIG;

  const supabase = await createServerClient();
  const { data, error } = await supabase
    .from("wakeup_configs")
    .select("*")
    .eq("clerk_user_id", userId)
    .maybeSingle();

  if (error) {
    console.error("Failed to load wakeup config:", error);
    return DEFAULT_WAKEUP_CONFIG;
  }

  return data ? fromDb(data as DbWakeupConfig) : DEFAULT_WAKEUP_CONFIG;
}

export async function saveWakeupConfig(config: WakeupConfig): Promise<void> {
  const { userId } = await auth();
  if (!userId) throw new Error("Not authenticated");

  const supabase = await createServerClient();
  const { error } = await supabase.from("wakeup_configs").upsert(
    {
      clerk_user_id: userId,
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
    },
    { onConflict: "clerk_user_id" },
  );

  if (error) {
    console.error("Failed to save wakeup config:", error);
    throw error;
  }
}
