import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/types/database";
import {
  DEFAULT_SELECTED_MODELS,
  type ScheduleMode,
  type WakeupConfig,
  type WakeupConfigInput,
} from "@/lib/types/wakeup";
import { validateCronExpression } from "./cron";

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const VALID_MODES: ScheduleMode[] = ["interval", "daily", "custom"];

export type { WakeupConfigInput };

export interface ValidationResult {
  valid: boolean;
  errors: Partial<Record<keyof WakeupConfigInput, string>>;
  config: WakeupConfigInput;
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((v): v is string => typeof v === "string");
}

function asInt(value: unknown, fallback: number): number {
  const n = typeof value === "string" ? Number(value) : (value as number);
  return Number.isFinite(n) ? Math.trunc(n) : fallback;
}

function asBool(value: unknown): boolean {
  return value === true || value === "true";
}

const KNOWN_MODELS = DEFAULT_SELECTED_MODELS as readonly string[];

// Coerces an arbitrary JSON body into a WakeupConfigInput, dropping unknown
// keys and falling back to safe defaults so a malformed client payload can't
// crash the server or persist garbage.
export function parseWakeupInput(body: unknown): WakeupConfigInput {
  const b = (typeof body === "object" && body !== null ? body : {}) as Record<
    string,
    unknown
  >;
  const modeRaw = b.scheduleMode;
  const scheduleMode: ScheduleMode =
    typeof modeRaw === "string" && VALID_MODES.includes(modeRaw as ScheduleMode)
      ? (modeRaw as ScheduleMode)
      : "interval";

  const rawCron =
    typeof b.cronExpression === "string" ? b.cronExpression : null;

  const selectedModels = asStringArray(b.selectedModels).filter((m) =>
    KNOWN_MODELS.includes(m),
  );

  return {
    enabled: asBool(b.enabled),
    selectedModels,
    selectedAccountIds: asStringArray(b.selectedAccountIds),
    scheduleMode,
    intervalHours: asInt(b.intervalHours, 6),
    dailyTimes: asStringArray(b.dailyTimes),
    cronExpression: rawCron,
    customPrompt: typeof b.customPrompt === "string" ? b.customPrompt : "hi",
    maxOutputTokens: asInt(b.maxOutputTokens, 1),
    cooldownMinutes: asInt(b.cooldownMinutes, 60),
    wakeOnReset: asBool(b.wakeOnReset),
  };
}

export function buildDefaultConfig(clerkUserId: string): WakeupConfig {
  return {
    id: "",
    clerkUserId,
    enabled: false,
    selectedModels: [...DEFAULT_SELECTED_MODELS],
    selectedAccountIds: [],
    scheduleMode: "interval",
    intervalHours: 6,
    dailyTimes: ["09:00", "15:00", "21:00"],
    cronExpression: null,
    customPrompt: "hi",
    maxOutputTokens: 1,
    cooldownMinutes: 60,
    wakeOnReset: false,
    updatedAt: "",
  };
}

type ConfigRow = Database["public"]["Tables"]["wakeup_configs"]["Row"];

export function rowToConfig(row: ConfigRow): WakeupConfig {
  return {
    id: row.id,
    clerkUserId: row.clerk_user_id,
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

export async function getWakeupConfig(
  supabase: SupabaseClient<Database>,
  clerkUserId: string,
): Promise<WakeupConfig | null> {
  const { data, error } = await supabase
    .from("wakeup_configs")
    .select("*")
    .eq("clerk_user_id", clerkUserId)
    .maybeSingle();

  if (error) {
    console.error("Failed to load wakeup config:", error);
    return null;
  }
  return data ? rowToConfig(data) : null;
}

export function validateWakeupInput(
  input: WakeupConfigInput,
): ValidationResult {
  const errors: ValidationResult["errors"] = {};

  if (!VALID_MODES.includes(input.scheduleMode)) {
    errors.scheduleMode = "Invalid schedule mode.";
  }

  if (input.intervalHours < 1 || input.intervalHours > 168) {
    errors.intervalHours = "Interval must be between 1 and 168 hours.";
  }

  if (input.maxOutputTokens < 1 || input.maxOutputTokens > 8192) {
    errors.maxOutputTokens = "Max output tokens must be between 1 and 8192.";
  }

  if (input.cooldownMinutes < 0 || input.cooldownMinutes > 1440) {
    errors.cooldownMinutes = "Cooldown must be between 0 and 1440 minutes.";
  }

  const invalidTimes = input.dailyTimes.filter((t) => !TIME_RE.test(t));
  if (input.dailyTimes.length > 0 && invalidTimes.length > 0) {
    errors.dailyTimes = `Invalid time(s): ${invalidTimes.join(", ")}. Use HH:MM (24h).`;
  }

  if (input.scheduleMode === "custom") {
    const expr = (input.cronExpression ?? "").trim();
    if (!expr) {
      errors.cronExpression = "Cron expression is required in custom mode.";
    } else {
      const result = validateCronExpression(expr);
      if (!result.valid) {
        errors.cronExpression = result.error ?? "Invalid cron expression.";
      }
    }
  }

  if (input.enabled && input.selectedModels.length === 0) {
    errors.selectedModels = "Select at least one model to wake up.";
  }

  if (!input.customPrompt || input.customPrompt.trim().length === 0) {
    errors.customPrompt = "Prompt cannot be empty.";
  }

  return {
    valid: Object.keys(errors).length === 0,
    errors,
    config: input,
  };
}

type ConfigInsert = Database["public"]["Tables"]["wakeup_configs"]["Insert"];

export function inputToRow(
  clerkUserId: string,
  input: WakeupConfigInput,
): ConfigInsert {
  return {
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
  };
}

export async function saveWakeupConfig(
  supabase: SupabaseClient<Database>,
  clerkUserId: string,
  input: WakeupConfigInput,
): Promise<{ config: WakeupConfig | null; error: string | null }> {
  const row = inputToRow(clerkUserId, input);
  const { data, error } = await supabase
    .from("wakeup_configs")
    .upsert(row, { onConflict: "clerk_user_id" })
    .select("*")
    .single();

  if (error) {
    console.error("Failed to save wakeup config:", error);
    return { config: null, error: error.message };
  }
  return { config: data ? rowToConfig(data) : null, error: null };
}
