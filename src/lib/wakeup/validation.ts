import type { ScheduleMode, WakeupConfig } from "@/lib/types/wakeup";
import { isUuid } from "@/lib/utils";
import { parseCronExpression } from "./cron";
import { defaultWakeupConfig, WAKEUP_MODELS } from "./models";

const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

const LIMITS = {
  selectedModels: 10,
  selectedAccountIds: 50,
  intervalHours: { min: 1, max: 168 },
  dailyTimes: { min: 1, max: 24 },
  cronExpressionLength: 120,
  customPromptLength: 500,
  maxOutputTokens: { min: 1, max: 8192 },
  cooldownMinutes: { min: 0, max: 10080 },
} as const;

const DEFAULT_CUSTOM_PROMPT = defaultWakeupConfig().customPrompt;

export type ConfigValidationResult =
  | { ok: true; value: WakeupConfig }
  | { ok: false; error: string };

/**
 * Validates an untrusted JSON body for PUT /api/wakeup/config and returns a
 * fully-normalized config. Never trusts client input: every field is checked
 * and coerced to its canonical form before persistence.
 */
export function validateWakeupConfigInput(
  body: unknown,
): ConfigValidationResult {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return { ok: false, error: "Request body must be a JSON object." };
  }
  const raw = body as Record<string, unknown>;

  const enabled = expectBoolean(raw.enabled);
  if (enabled === null) {
    return fail("enabled must be a boolean.");
  }

  // Caps are applied before any per-element work so oversized payloads are
  // rejected cheaply.
  const selectedModels = normalizeStringArray(
    raw.selectedModels,
    LIMITS.selectedModels,
  );
  if (!selectedModels) {
    return fail("selectedModels must be an array of strings.");
  }
  const validModels = selectedModels.filter((id) => MODEL_IDS.includes(id));
  if (validModels.length === 0) {
    return fail("Select at least one supported model to keep warm.");
  }

  const selectedAccountIds = normalizeStringArray(
    raw.selectedAccountIds,
    LIMITS.selectedAccountIds,
  );
  if (!selectedAccountIds || !selectedAccountIds.every((id) => isUuid(id))) {
    return fail("selectedAccountIds must be an array of account IDs.");
  }

  const scheduleModes: ScheduleMode[] = ["interval", "daily", "custom"];
  const rawScheduleMode = raw.scheduleMode;
  if (
    typeof rawScheduleMode !== "string" ||
    !scheduleModes.includes(rawScheduleMode as ScheduleMode)
  ) {
    return fail("scheduleMode must be one of: interval, daily, custom.");
  }
  const scheduleMode: ScheduleMode = rawScheduleMode as ScheduleMode;

  const intervalHours = expectIntInRange(
    raw.intervalHours,
    LIMITS.intervalHours.min,
    LIMITS.intervalHours.max,
  );
  if (intervalHours === null) {
    return fail(
      `intervalHours must be a whole number between ${LIMITS.intervalHours.min} and ${LIMITS.intervalHours.max}.`,
    );
  }

  const dailyTimesRaw = normalizeStringArray(
    raw.dailyTimes,
    LIMITS.dailyTimes.max,
  );
  if (!dailyTimesRaw || !dailyTimesRaw.every((t) => TIME_PATTERN.test(t))) {
    return fail("dailyTimes must be HH:MM strings (24-hour format).");
  }
  // Canonical order + no duplicates so comparisons are stable.
  const dailyTimes = [...new Set(dailyTimesRaw)].sort();

  let cronExpression: string | null = null;
  if (scheduleMode === "custom") {
    if (typeof raw.cronExpression !== "string" || !raw.cronExpression.trim()) {
      return fail("A cron expression is required for the custom schedule.");
    }
    if (raw.cronExpression.length > LIMITS.cronExpressionLength) {
      return fail(
        `Cron expression must be at most ${LIMITS.cronExpressionLength} characters.`,
      );
    }
    const parsed = parseCronExpression(raw.cronExpression);
    if (!parsed.ok) return fail(parsed.error);
    cronExpression = raw.cronExpression.trim().replace(/\s+/g, " ");
  }

  let customPrompt = DEFAULT_CUSTOM_PROMPT;
  if (raw.customPrompt !== undefined && raw.customPrompt !== null) {
    if (typeof raw.customPrompt !== "string") {
      return fail("customPrompt must be a string.");
    }
    if (raw.customPrompt.length > LIMITS.customPromptLength) {
      return fail(
        `customPrompt must be at most ${LIMITS.customPromptLength} characters.`,
      );
    }
    customPrompt = raw.customPrompt.trim();
  }

  const maxOutputTokens = expectIntInRange(
    raw.maxOutputTokens,
    LIMITS.maxOutputTokens.min,
    LIMITS.maxOutputTokens.max,
  );
  if (maxOutputTokens === null) {
    return fail(
      `maxOutputTokens must be between ${LIMITS.maxOutputTokens.min} and ${LIMITS.maxOutputTokens.max}.`,
    );
  }

  const cooldownMinutes = expectIntInRange(
    raw.cooldownMinutes,
    LIMITS.cooldownMinutes.min,
    LIMITS.cooldownMinutes.max,
  );
  if (cooldownMinutes === null) {
    return fail(
      `cooldownMinutes must be between ${LIMITS.cooldownMinutes.min} and ${LIMITS.cooldownMinutes.max}.`,
    );
  }

  const wakeOnReset = expectBoolean(raw.wakeOnReset);
  if (wakeOnReset === null) {
    return fail("wakeOnReset must be a boolean.");
  }

  // PUT replaces the whole config, so booleans must be sent explicitly:
  // defaulting absent fields would silently disable wakeup.
  if (enabled && scheduleMode === "daily") {
    if (dailyTimes.length < LIMITS.dailyTimes.min) {
      return fail("Add at least one daily time for the daily schedule.");
    }
  }

  return {
    ok: true,
    value: {
      enabled,
      selectedModels: [...new Set(validModels)],
      selectedAccountIds: [...new Set(selectedAccountIds)],
      scheduleMode,
      intervalHours,
      dailyTimes,
      cronExpression,
      customPrompt: customPrompt || DEFAULT_CUSTOM_PROMPT,
      maxOutputTokens,
      cooldownMinutes,
      wakeOnReset,
    },
  };
}

function fail(error: string): { ok: false; error: string } {
  return { ok: false, error };
}

/** Strict: absent fields are rejected so partial PUTs cannot reset state. */
function expectBoolean(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

function normalizeStringArray(
  value: unknown,
  maxLength: number,
): string[] | null {
  if (!Array.isArray(value)) return null;
  if (value.length > maxLength) return null;
  return value.every((item) => typeof item === "string")
    ? (value as string[])
    : null;
}

function expectIntInRange(
  value: unknown,
  min: number,
  max: number,
): number | null {
  if (typeof value !== "number" || !Number.isInteger(value)) return null;
  if (value < min || value > max) return null;
  return value;
}

const MODEL_IDS: string[] = WAKEUP_MODELS.map((model) => model.id);
