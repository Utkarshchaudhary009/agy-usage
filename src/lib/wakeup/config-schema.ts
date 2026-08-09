import {
  SCHEDULE_MODES,
  type ScheduleMode,
  WAKEUP_LIMITS,
  WAKEUP_MODEL_OPTIONS,
  type WakeupConfig,
} from "@/lib/types/wakeup";
import { isValidCron, MAX_CRON_EXPRESSION_LENGTH } from "./cron";
import { isValidTimeOfDay } from "./time-of-day";

/**
 * Validation and normalization of an untrusted wakeup config payload.
 *
 * This module is isomorphic on purpose: the API route runs it to decide what to
 * persist and the form runs it to decide whether "Save" is enabled, so the two
 * can never disagree about what a valid config is. It stays free of
 * `server-only` and of any Supabase/Next import for that reason.
 */

const INTEGER_RE = /^-?\d+$/;
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Model IDs are forwarded to Google's Cloud Code API as the `model` field of
 * the generate request, so they must never be free-form caller input.
 */
const ALLOWED_MODEL_IDS: ReadonlySet<string> = new Set(
  WAKEUP_MODEL_OPTIONS.map((model) => model.id),
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
    return fail("Invalid request body.");
  }
  const raw = input as Record<string, unknown>;

  const enabled = parseBoolean(raw.enabled);
  if (enabled === null) return fail("'enabled' must be a boolean.");

  const wakeOnReset = parseBoolean(raw.wakeOnReset);
  if (wakeOnReset === null) return fail("'wakeOnReset' must be a boolean.");

  const selectedModels = normalizeStringArray(
    raw.selectedModels,
    WAKEUP_LIMITS.maxSelectedModels,
  );
  if (selectedModels === null) {
    return fail(
      `Selected models must be a list of at most ${WAKEUP_LIMITS.maxSelectedModels} strings.`,
    );
  }
  if (selectedModels.some((model) => !ALLOWED_MODEL_IDS.has(model))) {
    return fail("Selected models contain an unsupported model.");
  }

  const selectedAccountIds = normalizeStringArray(
    raw.selectedAccountIds,
    WAKEUP_LIMITS.maxSelectedAccounts,
  );
  if (selectedAccountIds === null) {
    return fail(
      `Selected accounts must be a list of at most ${WAKEUP_LIMITS.maxSelectedAccounts} IDs.`,
    );
  }
  if (selectedAccountIds.some((id) => !UUID_RE.test(id))) {
    return fail("Selected accounts contain an invalid ID.");
  }

  const scheduleMode = parseScheduleMode(raw.scheduleMode);
  if (scheduleMode === null) {
    return fail("Schedule mode must be 'interval', 'daily', or 'custom'.");
  }

  const intervalHours = parseBoundedInt(
    raw.intervalHours,
    WAKEUP_LIMITS.minIntervalHours,
    WAKEUP_LIMITS.maxIntervalHours,
  );
  if (intervalHours === null) {
    return fail(
      `Interval must be a whole number between ${WAKEUP_LIMITS.minIntervalHours} and ${WAKEUP_LIMITS.maxIntervalHours} hours.`,
    );
  }

  const dailyTimes = normalizeStringArray(
    raw.dailyTimes,
    WAKEUP_LIMITS.maxDailyTimes,
  );
  if (dailyTimes === null) {
    return fail(
      `Daily times must be a list of at most ${WAKEUP_LIMITS.maxDailyTimes} entries.`,
    );
  }
  if (!dailyTimes.every(isValidTimeOfDay)) {
    return fail("Daily times must use the 24h HH:MM format.");
  }
  if (scheduleMode === "daily" && dailyTimes.length === 0) {
    return fail("Add at least one trigger time in daily mode.");
  }

  let cronExpression: string | null = null;
  if (scheduleMode === "custom") {
    const expr =
      typeof raw.cronExpression === "string" ? raw.cronExpression.trim() : "";
    if (!expr) return fail("A cron expression is required in custom mode.");
    if (expr.length > MAX_CRON_EXPRESSION_LENGTH) {
      return fail(
        `A cron expression must be at most ${MAX_CRON_EXPRESSION_LENGTH} characters.`,
      );
    }
    // The same parser the scheduler uses, so an expression can never be
    // accepted here and then re-interpreted differently at evaluation time.
    if (!isValidCron(expr)) {
      return fail(
        "Invalid cron expression. Use exactly 5 numeric fields, e.g. '0 9,15,21 * * *'.",
      );
    }
    cronExpression = expr;
  }

  const customPrompt =
    typeof raw.customPrompt === "string" ? raw.customPrompt : "";
  if (customPrompt.trim().length === 0) {
    return fail("The wakeup prompt cannot be empty.");
  }
  if (customPrompt.length > WAKEUP_LIMITS.maxPromptLength) {
    return fail(
      `The wakeup prompt is too long (max ${WAKEUP_LIMITS.maxPromptLength} characters).`,
    );
  }

  const maxOutputTokens = parseBoundedInt(
    raw.maxOutputTokens,
    WAKEUP_LIMITS.minOutputTokens,
    WAKEUP_LIMITS.maxOutputTokens,
  );
  if (maxOutputTokens === null) {
    return fail(
      `Max output tokens must be between ${WAKEUP_LIMITS.minOutputTokens} and ${WAKEUP_LIMITS.maxOutputTokens}.`,
    );
  }

  const cooldownMinutes = parseBoundedInt(
    raw.cooldownMinutes,
    WAKEUP_LIMITS.minCooldownMinutes,
    WAKEUP_LIMITS.maxCooldownMinutes,
  );
  if (cooldownMinutes === null) {
    return fail(
      `Cooldown must be between ${WAKEUP_LIMITS.minCooldownMinutes} and ${WAKEUP_LIMITS.maxCooldownMinutes} minutes.`,
    );
  }

  return {
    ok: true,
    config: {
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

function fail(error: string): ValidationResult {
  return { ok: false, error };
}

function parseScheduleMode(value: unknown): ScheduleMode | null {
  return typeof value === "string" &&
    SCHEDULE_MODES.includes(value as ScheduleMode)
    ? (value as ScheduleMode)
    : null;
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

  const seen = new Set<string>();
  for (const item of value) {
    if (typeof item !== "string") return null;
    seen.add(item.trim());
  }
  return [...seen];
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
