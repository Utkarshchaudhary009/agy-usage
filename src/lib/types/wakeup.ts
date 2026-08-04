export interface WakeupConfig {
  id: string;
  clerkUserId: string;
  enabled: boolean;
  selectedModels: string[];
  selectedAccountIds: string[];
  scheduleMode: "interval" | "daily" | "custom";
  intervalHours: number;
  dailyTimes: string[];
  cronExpression: string | null;
  customPrompt: string;
  maxOutputTokens: number;
  cooldownMinutes: number;
  wakeOnReset: boolean;
  updatedAt: string;
}

export interface WakeupLog {
  id: string;
  clerkUserId: string;
  accountId: string | null;
  modelId: string;
  triggerSource: "manual" | "scheduled" | "quota_reset";
  success: boolean;
  durationMs: number | null;
  error: string | null;
  responsePreview: string | null;
  createdAt: string;
}

export interface TriggerResult {
  success: boolean;
  durationMs: number;
  error?: string;
}

export interface WakeupResult {
  success: boolean;
  results: TriggerResult[];
  totalDurationMs: number;
  error?: string;
}
