import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/types/database";
import {
  DEFAULT_SELECTED_MODELS,
  isKnownWakeupModel,
  isUuid,
  type ScheduleMode,
  TIME_RE,
  WAKEUP_LIMITS,
  type WakeupConfig,
  type WakeupConfigInput,
} from "@/lib/types/wakeup";
import { validateCronExpression } from "./cron";

const VALID_MODES: ScheduleMode[] = ["interval", "daily", "custom"];

// Upper bound on how many raw array entries we will even look at, so a payload
// with a million-element array cannot burn CPU before validation rejects it.
const MAX_RAW_ARRAY_ENTRIES = 500;

// biome-ignore lint/suspicious/noControlCharactersInRegex: stripping C0/C1 control characters is exactly the intent
const CONTROL_CHARS_RE = /[\u0000-\u001f\u007f-\u009f]/g;

export type { WakeupConfigInput };

export interface ValidationResult {
  valid: boolean;
  errors: Partial<Record<keyof WakeupConfigInput, string>>;
  config: WakeupConfigInput;
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .slice(0, MAX_RAW_ARRAY_ENTRIES)
    .filter((v): v is string => typeof v === "string");
}

function asInt(value: unknown, fallback: number): number {
  const n = typeof value === "string" ? Number(value) : (value as number);
  return Number.isFinite(n) ? Math.trunc(n) : fallback;
}

function asBool(value: unknown): boolean {
  return value === true || value === "true";
}

function unique(values: string[]): string[] {
  return Array.from(new Set(values));
}

// Prompts are echoed back to the user and forwarded to Google on every
// scheduled run, so strip control characters (log/terminal injection, NUL
// bytes that Postgres rejects outright) and cap the length.
function sanitizePrompt(value: unknown): string {
  if (typeof value !== "string") return "hi";
  return value
    .replace(CONTROL_CHARS_RE, " ")
    .slice(0, WAKEUP_LIMITS.maxPromptLength);
}

// Coerces an arbitrary JSON body into a WakeupConfigInput, dropping unknown
// keys and falling back to safe defaults so a malformed client payload can't
// crash the server or persist garbage.
//
// Everything that later reaches Google's API or a Postgres typed column is
// normalized here: model ids are allowlisted, account ids must look like
// UUIDs (ownership is checked separately in the route), and every array is
// deduplicated and length-capped.
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

  // Cap before any parsing work: cron validation walks the string.
  const rawCron =
    typeof b.cronExpression === "string"
      ? b.cronExpression.slice(0, WAKEUP_LIMITS.maxCronLength)
      : null;

  // Allowlist against every known model, not just the default selection —
  // anything else is dropped rather than persisted and later sent to Google.
  const selectedModels = unique(asStringArray(b.selectedModels)).filter(
    isKnownWakeupModel,
  );

  // `selected_account_ids` is a Postgres UUID[]; a non-UUID string would abort
  // the whole upsert. Shape-check here, ownership-check in the route.
  const selectedAccountIds = unique(asStringArray(b.selectedAccountIds))
    .filter(isUuid)
    .slice(0, WAKEUP_LIMITS.maxSelectedAccounts);

  return {
    enabled: asBool(b.enabled),
    selectedModels,
    selectedAccountIds,
    scheduleMode,
    intervalHours: asInt(b.intervalHours, 6),
    dailyTimes: unique(asStringArray(b.dailyTimes)).slice(
      0,
      WAKEUP_LIMITS.maxDailyTimes,
    ),
    cronExpression: rawCron,
    customPrompt: sanitizePrompt(b.customPrompt),
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
    // Always re-apply the model allowlist at the read boundary: rows written
    // before a model was retired (or by anything other than the validated
    // config route) must never widen what the engine sends to Google.
    selectedModels: (row.selected_models ?? []).filter(isKnownWakeupModel),
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

  if (
    input.intervalHours < WAKEUP_LIMITS.minIntervalHours ||
    input.intervalHours > WAKEUP_LIMITS.maxIntervalHours
  ) {
    errors.intervalHours = `Interval must be between ${WAKEUP_LIMITS.minIntervalHours} and ${WAKEUP_LIMITS.maxIntervalHours} hours.`;
  }

  if (
    input.maxOutputTokens < WAKEUP_LIMITS.minOutputTokens ||
    input.maxOutputTokens > WAKEUP_LIMITS.maxOutputTokens
  ) {
    errors.maxOutputTokens = `Max output tokens must be between ${WAKEUP_LIMITS.minOutputTokens} and ${WAKEUP_LIMITS.maxOutputTokens}.`;
  }

  if (
    input.cooldownMinutes < WAKEUP_LIMITS.minCooldownMinutes ||
    input.cooldownMinutes > WAKEUP_LIMITS.maxCooldownMinutes
  ) {
    errors.cooldownMinutes = `Cooldown must be between ${WAKEUP_LIMITS.minCooldownMinutes} and ${WAKEUP_LIMITS.maxCooldownMinutes} minutes.`;
  }

  if (input.dailyTimes.length > WAKEUP_LIMITS.maxDailyTimes) {
    errors.dailyTimes = `At most ${WAKEUP_LIMITS.maxDailyTimes} daily times are allowed.`;
  } else if (input.dailyTimes.some((t) => !TIME_RE.test(t))) {
    // Deliberately does not echo the rejected values back: the message is
    // surfaced verbatim in the UI and written to logs.
    errors.dailyTimes = "Invalid time(s). Use HH:MM (24h).";
  }

  if (input.scheduleMode === "daily" && input.dailyTimes.length === 0) {
    errors.dailyTimes = "Add at least one daily time.";
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

  // Defense in depth: parseWakeupInput already drops unknown models, so an
  // unknown id here means the input bypassed the parser.
  if (input.selectedModels.some((m) => !isKnownWakeupModel(m))) {
    errors.selectedModels = "Unknown model selected.";
  } else if (input.enabled && input.selectedModels.length === 0) {
    errors.selectedModels = "Select at least one model to wake up.";
  }

  if (input.selectedAccountIds.length > WAKEUP_LIMITS.maxSelectedAccounts) {
    errors.selectedAccountIds = `At most ${WAKEUP_LIMITS.maxSelectedAccounts} accounts can be selected.`;
  } else if (input.selectedAccountIds.some((id) => !isUuid(id))) {
    errors.selectedAccountIds = "Invalid account selection.";
  }

  if (!input.customPrompt || input.customPrompt.trim().length === 0) {
    errors.customPrompt = "Prompt cannot be empty.";
  } else if (input.customPrompt.length > WAKEUP_LIMITS.maxPromptLength) {
    errors.customPrompt = `Prompt must be ${WAKEUP_LIMITS.maxPromptLength} characters or fewer.`;
  }

  return {
    valid: Object.keys(errors).length === 0,
    errors,
    config: input,
  };
}

/**
 * Confirms every selected account id belongs to `clerkUserId`.
 *
 * Without this a user could persist another tenant's account ids in their own
 * config row. Nothing downstream would act on them today (the scheduler
 * re-filters by owner), but storing cross-tenant identifiers is exactly the
 * kind of latent authorization gap that a later refactor turns into an IDOR.
 */
export async function assertOwnedAccountIds(
  supabase: SupabaseClient<Database>,
  clerkUserId: string,
  accountIds: string[],
): Promise<{ ok: boolean; error?: string }> {
  if (accountIds.length === 0) return { ok: true };

  const { data, error } = await supabase
    .from("google_accounts")
    .select("id")
    .eq("clerk_user_id", clerkUserId)
    .in("id", accountIds);

  if (error) {
    console.error("Failed to verify account ownership:", error);
    return { ok: false, error: "Could not verify the selected accounts." };
  }

  if ((data?.length ?? 0) !== accountIds.length) {
    return {
      ok: false,
      error: "One or more selected accounts do not exist.",
    };
  }

  return { ok: true };
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
