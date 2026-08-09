import type { TokenStatus } from "./account";
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

/**
 * The subset of the config that determines *when* a wakeup fires. The schedule
 * picker, the "next trigger" preview and the schedule evaluator all speak this
 * shape so the fields can never drift apart between them.
 */
export type WakeupSchedule = Pick<
  WakeupConfig,
  "scheduleMode" | "intervalHours" | "dailyTimes" | "cronExpression"
>;

/** The account fields the wakeup UI needs; a projection of `LinkedAccount`. */
export interface WakeupAccountOption {
  id: string;
  email: string;
  displayName: string | null;
  tokenStatus: TokenStatus;
}

export const SCHEDULE_MODES: readonly ScheduleMode[] = [
  "interval",
  "daily",
  "custom",
];

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

/**
 * The single source of truth for every bound on a wakeup config.
 *
 * The form inputs, the server-side validator and the CHECK constraints in
 * `supabase/migrations/009_wakeup.sql` all derive from these numbers. The
 * collection limits exist because a config fans out into one upstream Cloud
 * Code API call per (account x model) pair, so an unbounded list is an
 * amplification vector rather than just untidy data.
 */
export const WAKEUP_LIMITS = {
  maxSelectedModels: 16,
  maxSelectedAccounts: 50,
  maxDailyTimes: 12,
  maxPromptLength: 2000,
  minIntervalHours: 1,
  maxIntervalHours: 168,
  minOutputTokens: 1,
  maxOutputTokens: 8192,
  minCooldownMinutes: 0,
  maxCooldownMinutes: 1440,
} as const;

export const DEFAULT_WAKEUP_CONFIG: WakeupConfig = {
  enabled: false,
  selectedModels: WAKEUP_MODEL_OPTIONS.map((model) => model.id),
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

// `updated_at` is deliberately omitted: a BEFORE trigger stamps it from the
// database clock, so the value cannot be back-dated by whoever writes the row.
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
  };
}
