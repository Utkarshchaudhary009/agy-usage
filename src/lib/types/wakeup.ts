import { isValidCron, MAX_CRON_EXPRESSION_LENGTH } from "@/lib/wakeup/cron";
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

export const DEFAULT_WAKEUP_CONFIG: WakeupConfig = {
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
    updated_at: new Date().toISOString(),
  };
}

const SCHEDULE_MODES: ScheduleMode[] = ["interval", "daily", "custom"];
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const INTEGER_RE = /^-?\d+$/;

/**
 * Upper bounds on the collection fields. These stop a caller from persisting an
 * arbitrarily large payload that later fans out into one upstream Cloud Code
 * API call per (account x model) pair. They are mirrored by CHECK constraints
 * in `supabase/migrations/010_wakeup_hardening.sql`, because the browser can
 * reach PostgREST directly with the Clerk token and skip this route entirely.
 */
export const MAX_SELECTED_MODELS = 16;
export const MAX_SELECTED_ACCOUNTS = 50;
export const MAX_DAILY_TIMES = 12;
export const MAX_CUSTOM_PROMPT_LENGTH = 2000;

/**
 * Model IDs are forwarded to Google's Cloud Code API as the `model` field of
 * the generate request, so they must never be free-form caller input.
 */
const ALLOWED_MODEL_IDS: ReadonlySet<string> = new Set(
  WAKEUP_MODEL_OPTIONS.map((m) => m.id),
);

export type ValidationResult =
  | { ok: true; config: WakeupConfig }
  | { ok: false; error: string };

/**
 * Validates and normalizes an untrusted payload into a `WakeupConfig`.
 * Returns a single, human-readable error message on the first failure.
 *
 * Error messages never echo the caller-supplied value back.
 */
export function validateWakeupConfig(input: unknown): ValidationResult {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    return { ok: false, error: "Invalid request body." };
  }
  const raw = input as Record<string, unknown>;

  const enabled = parseBoolean(raw.enabled);
  if (enabled === null) {
    return { ok: false, error: "'enabled' must be a boolean." };
  }

  const wakeOnReset = parseBoolean(raw.wakeOnReset);
  if (wakeOnReset === null) {
    return { ok: false, error: "'wakeOnReset' must be a boolean." };
  }

  const selectedModels = normalizeStringArray(
    raw.selectedModels,
    MAX_SELECTED_MODELS,
  );
  if (selectedModels === null) {
    return {
      ok: false,
      error: `Selected models must be a list of at most ${MAX_SELECTED_MODELS} strings.`,
    };
  }
  if (selectedModels.some((m) => !ALLOWED_MODEL_IDS.has(m))) {
    return {
      ok: false,
      error: "Selected models contain an unsupported model.",
    };
  }

  const selectedAccountIds = normalizeStringArray(
    raw.selectedAccountIds,
    MAX_SELECTED_ACCOUNTS,
  );
  if (selectedAccountIds === null) {
    return {
      ok: false,
      error: `Selected accounts must be a list of at most ${MAX_SELECTED_ACCOUNTS} IDs.`,
    };
  }
  if (selectedAccountIds.some((id) => !isUuid(id))) {
    return { ok: false, error: "Selected accounts contain an invalid ID." };
  }

  const scheduleMode = raw.scheduleMode;
  if (
    typeof scheduleMode !== "string" ||
    !SCHEDULE_MODES.includes(scheduleMode as ScheduleMode)
  ) {
    return {
      ok: false,
      error: "Schedule mode must be 'interval', 'daily', or 'custom'.",
    };
  }

  const intervalHours = parseBoundedInt(raw.intervalHours, 1, 168);
  if (intervalHours === null) {
    return {
      ok: false,
      error: "Interval must be a whole number between 1 and 168 hours.",
    };
  }

  const dailyTimes = normalizeStringArray(raw.dailyTimes, MAX_DAILY_TIMES);
  if (dailyTimes === null) {
    return {
      ok: false,
      error: `Daily times must be a list of at most ${MAX_DAILY_TIMES} entries.`,
    };
  }
  if (dailyTimes.some((t) => !TIME_RE.test(t))) {
    return { ok: false, error: "Daily times must use the 24h HH:MM format." };
  }

  let cronExpression: string | null = null;
  if (scheduleMode === "custom") {
    const expr =
      typeof raw.cronExpression === "string" ? raw.cronExpression.trim() : "";
    if (!expr) {
      return {
        ok: false,
        error: "A cron expression is required in custom mode.",
      };
    }
    if (expr.length > MAX_CRON_EXPRESSION_LENGTH) {
      return {
        ok: false,
        error: `A cron expression must be at most ${MAX_CRON_EXPRESSION_LENGTH} characters.`,
      };
    }
    // Previously only emptiness was checked, so any string was persisted to
    // `cron_expression` and handed to the scheduler unvalidated.
    if (!isValidCron(expr)) {
      return {
        ok: false,
        error:
          "Invalid cron expression. Use exactly 5 numeric fields, e.g. '0 9,15,21 * * *'.",
      };
    }
    cronExpression = expr;
  }

  const customPrompt =
    typeof raw.customPrompt === "string" ? raw.customPrompt : "";
  if (customPrompt.trim().length === 0) {
    return { ok: false, error: "The wakeup prompt cannot be empty." };
  }
  if (customPrompt.length > MAX_CUSTOM_PROMPT_LENGTH) {
    return {
      ok: false,
      error: `The wakeup prompt is too long (max ${MAX_CUSTOM_PROMPT_LENGTH} characters).`,
    };
  }

  const maxOutputTokens = parseBoundedInt(raw.maxOutputTokens, 1, 8192);
  if (maxOutputTokens === null) {
    return {
      ok: false,
      error: "Max output tokens must be between 1 and 8192.",
    };
  }

  const cooldownMinutes = parseBoundedInt(raw.cooldownMinutes, 0, 1440);
  if (cooldownMinutes === null) {
    return { ok: false, error: "Cooldown must be between 0 and 1440 minutes." };
  }

  return {
    ok: true,
    config: {
      enabled,
      selectedModels,
      selectedAccountIds,
      scheduleMode: scheduleMode as ScheduleMode,
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
 * Returns the trimmed, de-duplicated strings, or `null` when the value is not a
 * string array or exceeds `limit`. Missing/null is treated as an empty list.
 *
 * De-duplication matters beyond tidiness: a repeated model or account ID would
 * otherwise multiply the number of upstream API calls a single schedule makes.
 */
function normalizeStringArray(value: unknown, limit: number): string[] | null {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || value.length > limit) return null;

  const out: string[] = [];
  for (const item of value) {
    if (typeof item !== "string") return null;
    const trimmed = item.trim();
    if (!out.includes(trimmed)) out.push(trimmed);
  }
  return out;
}

/**
 * Strict boolean coercion. `Boolean(x)` turned the string "false" into `true`,
 * which could enable a schedule the caller asked to disable.
 */
function parseBoolean(value: unknown): boolean | null {
  if (value === undefined || value === null) return false;
  if (typeof value === "boolean") return value;
  return null;
}

/**
 * Strict integer parsing. `Number.parseInt(String(x), 10)` accepted trailing
 * garbage ("6abc" -> 6) and stringified objects, so out-of-contract payloads
 * silently became valid values.
 */
function parseBoundedInt(
  value: unknown,
  min: number,
  max: number,
): number | null {
  let parsed: number;
  if (typeof value === "number") {
    parsed = value;
  } else if (typeof value === "string" && INTEGER_RE.test(value.trim())) {
    parsed = Number(value.trim());
  } else {
    return null;
  }

  if (!Number.isInteger(parsed) || parsed < min || parsed > max) return null;
  return parsed;
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
    value,
  );
}
