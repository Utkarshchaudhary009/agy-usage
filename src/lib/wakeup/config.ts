import "server-only";
import type { PostgrestError, SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/types/database";
import {
  DEFAULT_WAKEUP_CONFIG,
  isWakeupModelId,
  WAKEUP_LIMITS,
  type WakeupConfig,
  type WakeupConfigInput,
} from "@/lib/types/wakeup";
import { type CronValidationResult, validateCron } from "@/lib/wakeup/schedule";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

/**
 * SQLSTATE raised by `validate_and_upsert_wakeup_config` when a selected
 * account is not owned by the requesting user. Matching on the code (rather
 * than the message text) keeps the contract with the migration stable.
 * @see supabase/migrations/009_wakeup_config.sql
 */
const ACCOUNT_OWNERSHIP_SQLSTATE = "WK403";

/**
 * Thrown when a user attempts to save a config referencing account IDs that
 * are not owned by them. Surfaced to the API layer as a 403.
 */
export class AccountOwnershipError extends Error {
  constructor() {
    super("One or more accounts do not belong to this user.");
    this.name = "AccountOwnershipError";
  }
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

  const enabled = readBoolean(body.enabled, "enabled", errors);
  const wakeOnReset = readBoolean(body.wakeOnReset, "wakeOnReset", errors);

  const selectedModels = readStringArray(body.selectedModels);
  if (selectedModels === null) {
    errors.selectedModels = "Models must be an array of strings.";
  } else if (selectedModels.length === 0) {
    errors.selectedModels = "Select at least one model.";
  } else if (selectedModels.length > WAKEUP_LIMITS.maxSelectedModels) {
    errors.selectedModels = `Too many models selected (max ${WAKEUP_LIMITS.maxSelectedModels}).`;
  } else if (!selectedModels.every(isWakeupModelId)) {
    errors.selectedModels = "One or more models are invalid.";
  }

  // An empty array means "every linked account", so a malformed value must be
  // rejected rather than coerced — silently dropping bad entries would widen
  // the request instead of failing it.
  const selectedAccountIds = readStringArray(body.selectedAccountIds);
  if (selectedAccountIds === null) {
    errors.selectedAccountIds = "Account IDs must be an array of strings.";
  } else if (selectedAccountIds.length > WAKEUP_LIMITS.maxAccountIds) {
    errors.selectedAccountIds = `Too many accounts selected (max ${WAKEUP_LIMITS.maxAccountIds}).`;
  } else if (!selectedAccountIds.every((a) => UUID_RE.test(a))) {
    errors.selectedAccountIds = "One or more account IDs are invalid.";
  }

  const allowedModes = ["interval", "daily", "custom"] as const;
  const isAllowedMode = allowedModes.includes(body.scheduleMode as never);
  if (body.scheduleMode !== undefined && !isAllowedMode) {
    errors.scheduleMode = "Schedule mode must be interval, daily, or custom.";
  }
  const scheduleMode = isAllowedMode
    ? (body.scheduleMode as (typeof allowedModes)[number])
    : DEFAULT_WAKEUP_CONFIG.scheduleMode;

  const intervalHours = toInt(
    body.intervalHours,
    DEFAULT_WAKEUP_CONFIG.intervalHours,
  );
  if (
    intervalHours < WAKEUP_LIMITS.intervalHours.min ||
    intervalHours > WAKEUP_LIMITS.intervalHours.max
  ) {
    errors.intervalHours = `Interval must be between ${WAKEUP_LIMITS.intervalHours.min} and ${WAKEUP_LIMITS.intervalHours.max} hours.`;
  }

  const dailyTimes = readStringArray(body.dailyTimes);
  if (dailyTimes === null) {
    errors.dailyTimes = "Times must be an array of strings.";
  } else if (dailyTimes.length > WAKEUP_LIMITS.maxDailyTimes) {
    errors.dailyTimes = `Too many times selected (max ${WAKEUP_LIMITS.maxDailyTimes}).`;
  } else if (!dailyTimes.every((t) => TIME_RE.test(t))) {
    errors.dailyTimes = "Times must use HH:MM (24h) format.";
  } else if (scheduleMode === "daily" && dailyTimes.length === 0) {
    // A daily schedule with no times would never fire.
    errors.dailyTimes = "Add at least one trigger time.";
  }

  let cronExpression: string | null = null;
  if (typeof body.cronExpression === "string") {
    if (body.cronExpression.trim().length > WAKEUP_LIMITS.cronMaxLength) {
      errors.cronExpression = `Cron expression is too long (max ${WAKEUP_LIMITS.cronMaxLength} chars).`;
    } else if (body.cronExpression.trim()) {
      cronExpression = body.cronExpression.trim();
    }
  }
  if (scheduleMode === "custom" && !cronExpression) {
    errors.cronExpression =
      errors.cronExpression ?? "A cron expression is required in custom mode.";
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
  if (customPrompt.length > WAKEUP_LIMITS.promptMaxLength) {
    errors.customPrompt = `Prompt is too long (max ${WAKEUP_LIMITS.promptMaxLength} chars).`;
  }

  const maxOutputTokens = toInt(
    body.maxOutputTokens,
    DEFAULT_WAKEUP_CONFIG.maxOutputTokens,
  );
  if (
    maxOutputTokens < WAKEUP_LIMITS.maxOutputTokens.min ||
    maxOutputTokens > WAKEUP_LIMITS.maxOutputTokens.max
  ) {
    errors.maxOutputTokens = `Max output tokens must be between ${WAKEUP_LIMITS.maxOutputTokens.min} and ${WAKEUP_LIMITS.maxOutputTokens.max}.`;
  }

  const cooldownMinutes = toInt(
    body.cooldownMinutes,
    DEFAULT_WAKEUP_CONFIG.cooldownMinutes,
  );
  if (
    cooldownMinutes < WAKEUP_LIMITS.cooldownMinutes.min ||
    cooldownMinutes > WAKEUP_LIMITS.cooldownMinutes.max
  ) {
    errors.cooldownMinutes = `Cooldown must be between ${WAKEUP_LIMITS.cooldownMinutes.min} and ${WAKEUP_LIMITS.cooldownMinutes.max} minutes.`;
  }

  // The null checks are redundant with `errors` (each one already recorded a
  // message) but they narrow the types for the success payload below.
  if (
    Object.keys(errors).length > 0 ||
    selectedModels === null ||
    selectedAccountIds === null ||
    dailyTimes === null
  ) {
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
 * Reads a boolean field. An omitted field falls back to the default, but a
 * present non-boolean value is reported rather than coerced — `"false"`,
 * `0` or `null` must not silently become `false`.
 */
function readBoolean(
  value: unknown,
  field: "enabled" | "wakeOnReset",
  errors: Record<string, string>,
): boolean {
  if (value === undefined) return DEFAULT_WAKEUP_CONFIG[field];
  if (typeof value === "boolean") return value;
  errors[field] = "Value must be true or false.";
  return DEFAULT_WAKEUP_CONFIG[field];
}

/**
 * Reads an array-of-strings field. Returns `null` when the value is present
 * but is not an array of strings, so the caller can reject the request instead
 * of quietly dropping the offending entries.
 */
function readStringArray(value: unknown): string[] | null {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) return null;
  if (!value.every((item): item is string => typeof item === "string")) {
    return null;
  }
  return value;
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
 *
 * Identity is always derived from the Clerk-issued JWT inside the RPC via
 * `requesting_user_id()` — the application never writes `clerk_user_id` from
 * request input. This both prevents trusting client-supplied identity and keeps
 * validation + upsert atomic, avoiding a race where an account could be
 * deleted or reassigned between a separate validation query and the write.
 */
export async function saveWakeupConfig(
  supabase: SupabaseClient<Database>,
  input: WakeupConfigInput,
): Promise<WakeupConfig> {
  const { data: validated, error: validatedErr } = await supabase.rpc(
    "validate_and_upsert_wakeup_config",
    {
      p_enabled: input.enabled,
      p_selected_models: input.selectedModels,
      p_selected_account_ids: input.selectedAccountIds,
      p_schedule_mode: input.scheduleMode,
      p_interval_hours: input.intervalHours,
      p_daily_times: input.dailyTimes,
      p_cron_expression: input.cronExpression,
      p_custom_prompt: input.customPrompt,
      p_max_output_tokens: input.maxOutputTokens,
      p_cooldown_minutes: input.cooldownMinutes,
      p_wake_on_reset: input.wakeOnReset,
    },
  );

  if (validatedErr) {
    if (validatedErr.code === ACCOUNT_OWNERSHIP_SQLSTATE) {
      throw new AccountOwnershipError();
    }
    // Rethrown as-is (PostgrestError extends Error) so the API layer keeps the
    // `code`/`details`/`hint` metadata for logging instead of a flattened
    // message string.
    throw validatedErr;
  }

  if (!validated || !Array.isArray(validated) || validated.length === 0) {
    throw new Error("Failed to save wakeup config: No data returned");
  }

  return rowToConfig(validated[0]);
}

export function isPostgrestError(e: unknown): e is PostgrestError {
  return typeof e === "object" && e !== null && "code" in e && "message" in e;
}
