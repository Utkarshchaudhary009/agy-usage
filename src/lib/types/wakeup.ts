export type ScheduleMode = "interval" | "daily" | "custom";

export type ModelProvider = "anthropic" | "google";

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

export interface WakeupModelOption {
  id: string;
  label: string;
  provider: ModelProvider;
}

export const WAKEUP_MODEL_OPTIONS: WakeupModelOption[] = [
  {
    id: "claude-sonnet-4-5",
    label: "Claude Sonnet 4.5",
    provider: "anthropic",
  },
  { id: "gemini-3-flash", label: "Gemini 3 Flash", provider: "google" },
  { id: "gemini-3-pro-low", label: "Gemini 3 Pro (Low)", provider: "google" },
];

export const WAKEUP_MODEL_IDS: string[] = WAKEUP_MODEL_OPTIONS.map(
  (option) => option.id,
);

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

export interface WakeupAccountOption {
  id: string;
  email: string;
  displayName: string | null;
  isActive: boolean;
  tokenStatus: "active" | "expired" | "revoked";
}
