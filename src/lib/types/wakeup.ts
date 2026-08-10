export type ScheduleMode = "interval" | "daily" | "custom";

export type TriggerSource = "manual" | "scheduled" | "quota_reset";

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

export type WakeupConfigInput = Omit<
  WakeupConfig,
  "id" | "clerkUserId" | "updatedAt"
>;

export interface WakeupLog {
  id: string;
  clerkUserId: string;
  accountId: string | null;
  modelId: string;
  triggerSource: TriggerSource;
  success: boolean;
  durationMs: number | null;
  error: string | null;
  responsePreview: string | null;
  createdAt: string;
}

export const WAKEUP_MODELS = [
  {
    id: "claude-sonnet-4-5",
    label: "Claude Sonnet 4.5",
    provider: "ANTHROPIC",
  },
  {
    id: "gemini-3-flash",
    label: "Gemini 3 Flash",
    provider: "GOOGLE",
  },
  {
    id: "gemini-3-pro-low",
    label: "Gemini 3 Pro (Low)",
    provider: "GOOGLE",
  },
] as const;

export type WakeupModelId = (typeof WAKEUP_MODELS)[number]["id"];

export const WAKEUP_MODEL_IDS: readonly WakeupModelId[] = WAKEUP_MODELS.map(
  (m) => m.id,
);

export function isWakeupModelId(value: string): value is WakeupModelId {
  return (WAKEUP_MODEL_IDS as readonly string[]).includes(value);
}

export const DEFAULT_WAKEUP_CONFIG: WakeupConfigInput = {
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
