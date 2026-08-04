/**
 * Shared wakeup types and bounds.
 *
 * This module is imported by both server code (API route validation) and
 * client components (form state, schedule preview), so it must stay free of
 * `server-only` imports and side effects.
 *
 * Scheduling times (`dailyTimes`, `cronExpression`) are always interpreted in
 * **UTC** so that the browser preview and the server-side scheduler agree
 * regardless of where the user or the runtime is located.
 */

import type { TokenStatus } from "./account";

export const WAKEUP_MODELS = [
  { id: "claude-sonnet-4-5", label: "Claude Sonnet 4.5" },
  { id: "gemini-3-flash", label: "Gemini 3 Flash" },
  { id: "gemini-3-pro-low", label: "Gemini 3 Pro (Low)" },
] as const;

export type WakeupModel = (typeof WAKEUP_MODELS)[number];
export type WakeupModelId = WakeupModel["id"];

export const WAKEUP_MODEL_IDS: readonly WakeupModelId[] = WAKEUP_MODELS.map(
  (model) => model.id,
);

export type ScheduleMode = "interval" | "daily" | "custom";

export const SCHEDULE_MODES: readonly ScheduleMode[] = [
  "interval",
  "daily",
  "custom",
];

/**
 * Bounds are mirrored by CHECK constraints in `008_wakeup.sql`. Keep the two
 * in sync when changing a limit.
 */
export const WAKEUP_LIMITS = {
  intervalHours: { min: 1, max: 24 },
  maxOutputTokens: { min: 1, max: 64 },
  cooldownMinutes: { min: 0, max: 1440 },
  customPromptLength: { min: 1, max: 500 },
  cronExpressionLength: { max: 120 },
  selectedModels: { max: 20 },
  selectedAccountIds: { max: 50 },
  dailyTimes: { max: 24 },
} as const;

/** The user-editable part of a wakeup configuration. */
export interface WakeupConfigInput {
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

/** A stored configuration as returned by the API. */
export interface WakeupConfig extends WakeupConfigInput {
  /** ISO timestamp, or null when the user has never saved a config. */
  updatedAt: string | null;
}

/**
 * Matches the column defaults in `008_wakeup.sql`, and is what the API returns
 * for a user who has never saved a configuration.
 */
export const DEFAULT_WAKEUP_CONFIG: WakeupConfig = {
  enabled: false,
  selectedModels: [...WAKEUP_MODEL_IDS],
  selectedAccountIds: [],
  scheduleMode: "interval",
  intervalHours: 6,
  dailyTimes: ["09:00", "15:00", "21:00"],
  cronExpression: null,
  customPrompt: "hi",
  maxOutputTokens: 1,
  cooldownMinutes: 60,
  wakeOnReset: false,
  updatedAt: null,
};

/** The linked-account fields the wakeup UI needs. Never includes tokens. */
export interface WakeupAccountOption {
  id: string;
  email: string;
  displayName: string | null;
  tokenStatus: TokenStatus;
}
