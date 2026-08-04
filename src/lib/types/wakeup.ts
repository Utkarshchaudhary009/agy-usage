export type ScheduleMode = "interval" | "daily" | "custom";

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

export interface WakeupConfigFormData {
  enabled: boolean;
  selectedModels: string[];
  selectedAccountIds: string[];
  scheduleMode: ScheduleMode;
  intervalHours: number;
  dailyTimes: string[];
  cronExpression: string;
  customPrompt: string;
  maxOutputTokens: number;
  cooldownMinutes: number;
  wakeOnReset: boolean;
}
