import type { ScheduleMode } from "@/lib/wakeup/schedule-evaluator";

export type { ScheduleMode };

export interface WakeupAccount {
  id: string;
  email: string | null;
  displayName: string | null;
}

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

export interface TriggerSingleResult {
  accountId: string;
  modelId: string;
  success: boolean;
  durationMs: number;
  error?: string;
  responsePreview?: string;
}

export interface TriggerAllResult {
  clerkUserId: string;
  results: TriggerSingleResult[];
  skipped: boolean;
  skipReason?: string;
}
