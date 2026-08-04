/**
 * Validation and normalisation for wakeup configuration payloads.
 *
 * The API route is the authority, but this module is pure so the client form
 * can surface the same messages before submitting. Rules mirror the CHECK
 * constraints in `008_wakeup.sql`.
 */

import {
  SCHEDULE_MODES,
  type ScheduleMode,
  WAKEUP_LIMITS,
  WAKEUP_MODEL_IDS,
  type WakeupConfigInput,
} from "@/lib/types/wakeup";
import {
  getMinimumGapMinutes,
  normalizeCronExpression,
  parseCronExpression,
} from "./cron";
import { isValidDailyTime } from "./schedule";

export type WakeupValidationResult =
  | { ok: true; value: WakeupConfigInput }
  | { ok: false; field: string; message: string };

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

// Widened to Set<string> so untrusted input can be tested without casting.
const ALLOWED_MODEL_IDS = new Set<string>(WAKEUP_MODEL_IDS);
const ALLOWED_SCHEDULE_MODES = new Set<string>(SCHEDULE_MODES);

/**
 * `interval` and `daily` modes cap out at 24 runs a day; without a floor a
 * custom cron could fire every minute and hammer the upstream Google API.
 */
const MIN_CRON_GAP_MINUTES = 15;

/** User-facing names, since these messages are rendered verbatim in the UI. */
const FIELD_LABELS: Record<string, string> = {
  enabled: "Automatic wakeup",
  selectedModels: "Models",
  selectedAccountIds: "Accounts",
  scheduleMode: "Schedule mode",
  intervalHours: "Trigger frequency",
  dailyTimes: "Daily trigger times",
  cronExpression: "Cron expression",
  customPrompt: "Prompt",
  maxOutputTokens: "Max output tokens",
  cooldownMinutes: "Cooldown",
  wakeOnReset: "Wake on quota reset",
};

function label(field: string): string {
  return FIELD_LABELS[field] ?? field;
}

function isScheduleMode(value: unknown): value is ScheduleMode {
  return typeof value === "string" && ALLOWED_SCHEDULE_MODES.has(value);
}

function fail(field: string, message: string): WakeupValidationResult {
  return { ok: false, field, message };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readBoolean(value: unknown, field: string) {
  return typeof value === "boolean"
    ? { ok: true as const, value }
    : {
        ok: false as const,
        error: fail(field, `${label(field)} must be a boolean.`),
      };
}

function readInteger(
  value: unknown,
  field: string,
  bounds: { min: number; max: number },
) {
  if (typeof value !== "number" || !Number.isInteger(value)) {
    return {
      ok: false as const,
      error: fail(field, `${label(field)} must be a whole number.`),
    };
  }
  if (value < bounds.min || value > bounds.max) {
    return {
      ok: false as const,
      error: fail(
        field,
        `${label(field)} must be between ${bounds.min} and ${bounds.max}.`,
      ),
    };
  }
  return { ok: true as const, value };
}

function readStringArray(value: unknown, field: string, max: number) {
  if (!Array.isArray(value)) {
    return {
      ok: false as const,
      error: fail(field, `${label(field)} must be a list.`),
    };
  }
  if (value.length > max) {
    return {
      ok: false as const,
      error: fail(
        field,
        `${label(field)} cannot contain more than ${max} entries.`,
      ),
    };
  }
  if (!value.every((entry): entry is string => typeof entry === "string")) {
    return {
      ok: false as const,
      error: fail(field, `${label(field)} must only contain text values.`),
    };
  }
  // De-duplicate so a caller cannot inflate fan-out with repeated entries.
  return { ok: true as const, value: [...new Set(value)] };
}

/**
 * Validates an untrusted payload and returns a normalised config.
 *
 * Normalisation: arrays de-duplicated, daily times sorted, prompt trimmed,
 * cron whitespace collapsed, and `cronExpression` cleared unless the schedule
 * mode is `custom`.
 */
export function validateWakeupConfigInput(
  raw: unknown,
): WakeupValidationResult {
  if (!isRecord(raw)) {
    return fail("body", "Request body must be a JSON object.");
  }

  const enabled = readBoolean(raw.enabled, "enabled");
  if (!enabled.ok) return enabled.error;

  const wakeOnReset = readBoolean(raw.wakeOnReset, "wakeOnReset");
  if (!wakeOnReset.ok) return wakeOnReset.error;

  const selectedModels = readStringArray(
    raw.selectedModels,
    "selectedModels",
    WAKEUP_LIMITS.selectedModels.max,
  );
  if (!selectedModels.ok) return selectedModels.error;

  const unknownModel = selectedModels.value.find(
    (modelId) => !ALLOWED_MODEL_IDS.has(modelId),
  );
  if (unknownModel !== undefined) {
    return fail("selectedModels", "One or more selected models are not valid.");
  }

  const selectedAccountIds = readStringArray(
    raw.selectedAccountIds,
    "selectedAccountIds",
    WAKEUP_LIMITS.selectedAccountIds.max,
  );
  if (!selectedAccountIds.ok) return selectedAccountIds.error;

  if (!selectedAccountIds.value.every((id) => UUID_PATTERN.test(id))) {
    return fail("selectedAccountIds", "Account ids must be valid UUIDs.");
  }

  if (!isScheduleMode(raw.scheduleMode)) {
    return fail(
      "scheduleMode",
      "Schedule mode must be one of: interval, daily, custom.",
    );
  }
  const scheduleMode = raw.scheduleMode;

  const intervalHours = readInteger(
    raw.intervalHours,
    "intervalHours",
    WAKEUP_LIMITS.intervalHours,
  );
  if (!intervalHours.ok) return intervalHours.error;

  const maxOutputTokens = readInteger(
    raw.maxOutputTokens,
    "maxOutputTokens",
    WAKEUP_LIMITS.maxOutputTokens,
  );
  if (!maxOutputTokens.ok) return maxOutputTokens.error;

  const cooldownMinutes = readInteger(
    raw.cooldownMinutes,
    "cooldownMinutes",
    WAKEUP_LIMITS.cooldownMinutes,
  );
  if (!cooldownMinutes.ok) return cooldownMinutes.error;

  const dailyTimes = readStringArray(
    raw.dailyTimes,
    "dailyTimes",
    WAKEUP_LIMITS.dailyTimes.max,
  );
  if (!dailyTimes.ok) return dailyTimes.error;

  if (!dailyTimes.value.every(isValidDailyTime)) {
    return fail("dailyTimes", "Times must use 24-hour HH:MM format.");
  }
  const sortedDailyTimes = [...dailyTimes.value].sort();

  if (typeof raw.customPrompt !== "string") {
    return fail("customPrompt", "Prompt must be text.");
  }
  const customPrompt = raw.customPrompt.trim();
  if (
    customPrompt.length < WAKEUP_LIMITS.customPromptLength.min ||
    customPrompt.length > WAKEUP_LIMITS.customPromptLength.max
  ) {
    return fail(
      "customPrompt",
      `Prompt must be between ${WAKEUP_LIMITS.customPromptLength.min} and ${WAKEUP_LIMITS.customPromptLength.max} characters.`,
    );
  }

  if (
    raw.cronExpression !== null &&
    raw.cronExpression !== undefined &&
    typeof raw.cronExpression !== "string"
  ) {
    return fail("cronExpression", "Cron expression must be text.");
  }

  let cronExpression: string | null = null;
  if (scheduleMode === "custom") {
    const candidate =
      typeof raw.cronExpression === "string" ? raw.cronExpression : "";
    const parsed = parseCronExpression(candidate);
    if (!parsed.ok) {
      return fail("cronExpression", parsed.error);
    }
    // Interval and daily modes top out at 24 runs a day; keep custom cron in
    // the same ballpark so a schedule cannot hammer the upstream API.
    if (getMinimumGapMinutes(parsed.schedule) < MIN_CRON_GAP_MINUTES) {
      return fail(
        "cronExpression",
        `Cron schedule must leave at least ${MIN_CRON_GAP_MINUTES} minutes between runs.`,
      );
    }
    cronExpression = normalizeCronExpression(candidate);
  }

  // Mirrors wakeup_configs_enabled_requires_targets so an invalid combination
  // fails with a 400 instead of a database constraint error.
  if (enabled.value) {
    if (selectedModels.value.length === 0) {
      return fail(
        "selectedModels",
        "Select at least one model before enabling wakeup.",
      );
    }
    if (selectedAccountIds.value.length === 0) {
      return fail(
        "selectedAccountIds",
        "Select at least one account before enabling wakeup.",
      );
    }
    if (scheduleMode === "daily" && sortedDailyTimes.length === 0) {
      return fail(
        "dailyTimes",
        "Add at least one daily time before enabling wakeup.",
      );
    }
  }

  return {
    ok: true,
    value: {
      enabled: enabled.value,
      selectedModels: selectedModels.value,
      selectedAccountIds: selectedAccountIds.value,
      scheduleMode,
      intervalHours: intervalHours.value,
      dailyTimes: sortedDailyTimes,
      cronExpression,
      customPrompt,
      maxOutputTokens: maxOutputTokens.value,
      cooldownMinutes: cooldownMinutes.value,
      wakeOnReset: wakeOnReset.value,
    },
  };
}
