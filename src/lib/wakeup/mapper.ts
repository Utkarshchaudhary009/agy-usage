import "server-only";
import type { Database } from "@/lib/types/database";
import type { WakeupConfig } from "@/lib/types/wakeup";

type WakeupConfigRow = Database["public"]["Tables"]["wakeup_configs"]["Row"];

/** Maps a database row to the camelCase shape used by UI and API payloads. */
export function toWakeupConfig(row: WakeupConfigRow): WakeupConfig {
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
    updatedAt: row.updated_at,
  };
}
