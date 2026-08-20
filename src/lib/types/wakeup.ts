import type { Database } from "@/lib/types/database";

export type WakeupScheduleMode = "interval" | "daily" | "custom";

type WakeupConfigRow = Database["public"]["Tables"]["wakeup_configs"]["Row"];

export interface WakeupConfig {
  clerkUserId: string;
  enabled: boolean;
  selectedModels: string[];
  selectedAccountIds: string[];
  scheduleMode: WakeupScheduleMode;
  intervalHours: number;
  dailyTimes: string[];
  cronExpression: string | null;
  customPrompt: string;
  maxOutputTokens: number;
  cooldownMinutes: number;
  wakeOnReset: boolean;
}

// Known model identifiers that can be woken up. The wakeup trigger calls the
// Cloud Code streamGenerateContent endpoint per selected model. Display names
// and providers mirror how they appear in the quota dashboard.
export interface WakeupModelOption {
  id: string;
  label: string;
  provider: "ANTHROPIC" | "GOOGLE";
}

export const WAKEUP_MODELS: WakeupModelOption[] = [
  {
    id: "claude-sonnet-4-5",
    label: "Claude Sonnet 4.5",
    provider: "ANTHROPIC",
  },
  { id: "claude-opus-4-5", label: "Claude Opus 4.5", provider: "ANTHROPIC" },
  { id: "gemini-3-flash", label: "Gemini 3 Flash", provider: "GOOGLE" },
  { id: "gemini-3-pro", label: "Gemini 3 Pro", provider: "GOOGLE" },
  { id: "gemini-3-pro-low", label: "Gemini 3 Pro (Low)", provider: "GOOGLE" },
];

export const DEFAULT_WAKEUP_CONFIG: Omit<
  WakeupConfig,
  "clerkUserId" | "selectedAccountIds"
> = {
  enabled: false,
  selectedModels: ["claude-sonnet-4-5", "gemini-3-flash", "gemini-3-pro-low"],
  scheduleMode: "interval",
  intervalHours: 6,
  dailyTimes: ["09:00", "15:00", "21:00"],
  cronExpression: null,
  customPrompt: "hi",
  maxOutputTokens: 1,
  cooldownMinutes: 60,
  wakeOnReset: false,
};

const SCHEDULE_MODES: WakeupScheduleMode[] = ["interval", "daily", "custom"];

export const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

export interface WakeupValidationResult {
  valid: boolean;
  errors: Partial<Record<keyof WakeupConfig, string>>;
}

function clampInt(value: unknown, min: number, max: number, fallback: number) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.round(n)));
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((v): v is string => typeof v === "string")
    .map((v) => v.trim())
    .filter((v) => v.length > 0);
}

// Validates and coerces an untrusted payload (e.g. from the PUT route body)
// into a well-formed WakeupConfig. Used server-side before any database write,
// so this is the only place that decides what gets persisted.
export function parseWakeupConfig(
  input: unknown,
  clerkUserId: string,
  fallbackAccountIds: string[] = [],
): WakeupConfig & { validation: WakeupValidationResult } {
  const errors: WakeupValidationResult["errors"] = {};
  const raw = (input ?? {}) as Record<string, unknown>;

  const enabled = raw.enabled === true;

  const knownModelIds = new Set(WAKEUP_MODELS.map((m) => m.id));
  const selectedModels = Array.from(
    new Set(
      asStringArray(raw.selectedModels).filter((id) => knownModelIds.has(id)),
    ),
  );
  if (enabled && selectedModels.length === 0) {
    errors.selectedModels = "Select at least one model to wake up.";
  }

  // Account ids are validated against the caller's accounts by the route layer;
  // here we only de-duplicate and keep the shape clean.
  const selectedAccountIds = Array.from(
    new Set(asStringArray(raw.selectedAccountIds)),
  );

  const scheduleMode = SCHEDULE_MODES.includes(
    raw.scheduleMode as WakeupScheduleMode,
  )
    ? (raw.scheduleMode as WakeupScheduleMode)
    : "interval";

  const intervalHours = clampInt(raw.intervalHours, 1, 168, 6);

  const dailyTimes = asStringArray(raw.dailyTimes).filter((t) =>
    TIME_RE.test(t),
  );
  if (scheduleMode === "daily" && dailyTimes.length === 0) {
    errors.dailyTimes = "Add at least one daily trigger time (HH:MM).";
  }

  const cronExpression =
    scheduleMode === "custom"
      ? (typeof raw.cronExpression === "string"
          ? raw.cronExpression.trim()
          : "") || null
      : null;

  const rawPrompt =
    typeof raw.customPrompt === "string" ? raw.customPrompt.trim() : "";
  const customPrompt = rawPrompt.length > 0 ? rawPrompt.slice(0, 4000) : "hi";

  const maxOutputTokens = clampInt(raw.maxOutputTokens, 1, 8192, 1);
  const cooldownMinutes = clampInt(raw.cooldownMinutes, 0, 1440, 60);
  const wakeOnReset = raw.wakeOnReset === true;

  const config: WakeupConfig = {
    clerkUserId,
    enabled,
    selectedModels,
    selectedAccountIds:
      selectedAccountIds.length > 0 ? selectedAccountIds : fallbackAccountIds,
    scheduleMode,
    intervalHours,
    dailyTimes:
      scheduleMode === "daily" ? dailyTimes : DEFAULT_WAKEUP_CONFIG.dailyTimes,
    cronExpression,
    customPrompt,
    maxOutputTokens,
    cooldownMinutes,
    wakeOnReset,
  };

  return {
    ...config,
    validation: { valid: Object.keys(errors).length === 0, errors },
  };
}

// Maps a raw `wakeup_configs` database row (snake_case) into the camelCase
// WakeupConfig used throughout the app. Centralized so the mapping lives in one
// place instead of being repeated across the page loader and API routes.
export function mapWakeupConfigRow(row: WakeupConfigRow): WakeupConfig {
  return {
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
  };
}

// Builds the default config for a user who has not saved one yet.
export function defaultWakeupConfig(userId: string): WakeupConfig {
  return {
    ...DEFAULT_WAKEUP_CONFIG,
    clerkUserId: userId,
    selectedAccountIds: [],
  };
}
