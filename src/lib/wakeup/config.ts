import "server-only";
import type { PostgrestError, SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/types/database";
import {
  DEFAULT_WAKEUP_CONFIG,
  isWakeupModelId,
  type WakeupConfig,
} from "@/lib/types/wakeup";
import { type CronValidationResult, validateCron } from "@/lib/wakeup/schedule";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

export interface WakeupConfigInput {
  enabled: boolean;
  selectedModels: string[];
  selectedAccountIds: string[];
  scheduleMode: "interval" | "daily" | "custom";
  intervalHours: number;
  dailyTimes: string[];
  cronExpression: string | null;
  customPrompt: string;
  maxOutputTokens: number;
  cooldownMinutes: number;
  wakeOnReset: boolean;
}

export interface ValidationResult {
  valid: boolean;
  errors: Record<string, string>;
  data?: WakeupConfigInput;
}

type ConfigRow = Database["public"]["Tables"]["wakeup_configs"]["Row"];

function rowToConfig(row: ConfigRow): WakeupConfig {
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

export function defaultConfig(clerkUserId: string): WakeupConfig {
  return {
    id: "",
    clerkUserId,
    ...DEFAULT_WAKEUP_CONFIG,
    updatedAt: new Date(0).toISOString(),
  };
}

/**
 * Validates and normalizes an untrusted payload into a WakeupConfigInput.
 * Returns a map of field -> error message for any invalid values.
 */
export function validateWakeupInput(raw: unknown): ValidationResult {
  const errors: Record<string, string> = {};
  if (typeof raw !== "object" || raw === null) {
    return { valid: false, errors: { body: "Invalid request body." } };
  }
  const body = raw as Record<string, unknown>;

  const enabled = body.enabled === true;
  const wakeOnReset = body.wakeOnReset === true;

  const selectedModels = Array.isArray(body.selectedModels)
    ? body.selectedModels.filter((m): m is string => typeof m === "string")
    : [];
  if (selectedModels.length === 0) {
    errors.selectedModels = "Select at least one model.";
  } else if (!selectedModels.every(isWakeupModelId)) {
    errors.selectedModels = "One or more models are invalid.";
  }

  const selectedAccountIds = Array.isArray(body.selectedAccountIds)
    ? body.selectedAccountIds.filter((a): a is string => typeof a === "string")
    : [];
  if (
    selectedAccountIds.length > 0 &&
    !selectedAccountIds.every((a) => UUID_RE.test(a))
  ) {
    errors.selectedAccountIds = "One or more account IDs are invalid.";
  }

  const allowedModes = ["interval", "daily", "custom"] as const;
  const scheduleMode = allowedModes.includes(body.scheduleMode as never)
    ? (body.scheduleMode as (typeof allowedModes)[number])
    : "interval";

  const intervalHours = toInt(
    body.intervalHours,
    DEFAULT_WAKEUP_CONFIG.intervalHours,
  );
  if (intervalHours < 1 || intervalHours > 168) {
    errors.intervalHours = "Interval must be between 1 and 168 hours.";
  }

  const dailyTimes = Array.isArray(body.dailyTimes)
    ? body.dailyTimes.filter((t): t is string => typeof t === "string")
    : [];
  if (dailyTimes.length > 0 && !dailyTimes.every((t) => TIME_RE.test(t))) {
    errors.dailyTimes = "Times must use HH:MM (24h) format.";
  }

  let cronExpression: string | null = null;
  if (typeof body.cronExpression === "string" && body.cronExpression.trim()) {
    cronExpression = body.cronExpression.trim();
  }
  if (scheduleMode === "custom" && !cronExpression) {
    errors.cronExpression = "A cron expression is required in custom mode.";
  }
  let cronCheck: CronValidationResult = { valid: true };
  if (cronExpression) {
    cronCheck = validateCron(cronExpression);
    if (!cronCheck.valid) {
      errors.cronExpression = cronCheck.error ?? "Invalid cron expression.";
    }
  }

  const customPrompt =
    typeof body.customPrompt === "string" && body.customPrompt.trim()
      ? body.customPrompt.trim()
      : DEFAULT_WAKEUP_CONFIG.customPrompt;
  if (customPrompt.length > 2000) {
    errors.customPrompt = "Prompt is too long (max 2000 chars).";
  }

  const maxOutputTokens = toInt(
    body.maxOutputTokens,
    DEFAULT_WAKEUP_CONFIG.maxOutputTokens,
  );
  if (maxOutputTokens < 1 || maxOutputTokens > 8192) {
    errors.maxOutputTokens = "Max output tokens must be between 1 and 8192.";
  }

  const cooldownMinutes = toInt(
    body.cooldownMinutes,
    DEFAULT_WAKEUP_CONFIG.cooldownMinutes,
  );
  if (cooldownMinutes < 0 || cooldownMinutes > 1440) {
    errors.cooldownMinutes = "Cooldown must be between 0 and 1440 minutes.";
  }

  if (Object.keys(errors).length > 0) {
    return { valid: false, errors };
  }

  return {
    valid: true,
    errors,
    data: {
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

function toInt(value: unknown, fallback: number): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.trunc(value);
  }
  if (typeof value === "string" && value.trim() !== "") {
    const n = Number(value);
    if (Number.isFinite(n)) return Math.trunc(n);
  }
  return fallback;
}

/**
 * Returns the user's stored wakeup config, or a default if none exists.
 */
export async function getWakeupConfig(
  supabase: SupabaseClient<Database>,
  clerkUserId: string,
): Promise<WakeupConfig> {
  const { data, error } = await supabase
    .from("wakeup_configs")
    .select("*")
    .eq("clerk_user_id", clerkUserId)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to load wakeup config: ${error.message}`);
  }
  if (!data) return defaultConfig(clerkUserId);
  return rowToConfig(data);
}

/**
 * Upserts the user's wakeup config after verifying that every selected account
 * belongs to the authenticated user (RLS also enforces this, but we fail fast
 * with a clear validation error rather than a generic RLS rejection).
 */
export async function saveWakeupConfig(
  supabase: SupabaseClient<Database>,
  clerkUserId: string,
  input: WakeupConfigInput,
): Promise<WakeupConfig> {
  if (input.selectedAccountIds.length > 0) {
    const { data: owned, error: ownedErr } = await supabase
      .from("google_accounts")
      .select("id")
      .eq("clerk_user_id", clerkUserId)
      .in("id", input.selectedAccountIds);

    if (ownedErr) {
      throw new Error(`Failed to verify accounts: ${ownedErr.message}`);
    }
    const ownedIds = new Set((owned ?? []).map((a) => a.id));
    const unauthorized = input.selectedAccountIds.filter(
      (id) => !ownedIds.has(id),
    );
    if (unauthorized.length > 0) {
      throw new Error("One or more accounts do not belong to this user.");
    }
  }

  const row = {
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

  const { data, error } = await supabase
    .from("wakeup_configs")
    .upsert(row, { onConflict: "clerk_user_id" })
    .select("*")
    .single();

  if (error) {
    throw new Error(`Failed to save wakeup config: ${error.message}`);
  }

  return rowToConfig(data);
}

export function isPostgrestError(e: unknown): e is PostgrestError {
  return typeof e === "object" && e !== null && "code" in e && "message" in e;
}
