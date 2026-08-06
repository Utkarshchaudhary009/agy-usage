export type ScheduleMode = "interval" | "daily" | "custom";
export type TriggerSource = "manual" | "scheduled" | "quota_reset";

export const SCHEDULE_MODES: ScheduleMode[] = ["interval", "daily", "custom"];

export const DEFAULT_SELECTED_MODELS = [
  "claude-sonnet-4-5",
  "gemini-3-flash",
  "gemini-3-pro-low",
] as const;

export interface WakeupConfig {
  id: string;
  clerkUserId: string;
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
  updatedAt: string;
}

// Editable subset of WakeupConfig exchanged between the client form and the
// config API. Lives here (not in the server-only config module) so client
// components can reference it without pulling in server code.
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

export const WAKEUP_MODELS: { id: string; label: string; provider: string }[] =
  [
    {
      id: "claude-sonnet-4-5",
      label: "Claude Sonnet 4.5",
      provider: "Anthropic",
    },
    { id: "claude-opus-4-5", label: "Claude Opus 4.5", provider: "Anthropic" },
    {
      id: "claude-haiku-4-5",
      label: "Claude Haiku 4.5",
      provider: "Anthropic",
    },
    { id: "gemini-3-flash", label: "Gemini 3 Flash", provider: "Google" },
    { id: "gemini-3-pro", label: "Gemini 3 Pro", provider: "Google" },
    { id: "gemini-3-pro-low", label: "Gemini 3 Pro (Low)", provider: "Google" },
  ];

export function modelLabel(modelId: string): string {
  return WAKEUP_MODELS.find((m) => m.id === modelId)?.label ?? modelId;
}

// Allowlist of model ids the wakeup engine may ever send to Google. Every
// model id that reaches the Cloud Code API — whether it came from a request
// body or from a stored config row — must be checked against this list, so an
// attacker (or a stale/tampered row) cannot make the server issue requests for
// arbitrary models on a linked Google account.
export const WAKEUP_MODEL_IDS: readonly string[] = WAKEUP_MODELS.map(
  (m) => m.id,
);

export function isKnownWakeupModel(modelId: string): boolean {
  return WAKEUP_MODEL_IDS.includes(modelId);
}

// Hard input bounds, shared by the client form and the server-side validator.
// These cap how much work a single stored config can schedule against Google's
// API, and keep unbounded user text out of the database.
export const WAKEUP_LIMITS = {
  /** Wake-up prompts are meant to be tiny ("hi"); this is generous headroom. */
  maxPromptLength: 2000,
  maxDailyTimes: 24,
  maxCronLength: 120,
  maxSelectedAccounts: 100,
  minIntervalHours: 1,
  maxIntervalHours: 168,
  minOutputTokens: 1,
  maxOutputTokens: 8192,
  minCooldownMinutes: 0,
  maxCooldownMinutes: 1440,
  /** Trigger errors are persisted for debugging; keep the column bounded. */
  maxStoredErrorLength: 500,
} as const;

// Accepts any canonical 8-4-4-4-12 hex UUID. This is a shape check only —
// ownership is always verified against `google_accounts` separately.
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: string): boolean {
  return UUID_RE.test(value);
}

// Accepts a 24-hour HH:MM time. Shared by the server-side validator and the
// client-side schedule picker, so it lives in this isomorphic module.
export const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
