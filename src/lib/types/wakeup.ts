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
