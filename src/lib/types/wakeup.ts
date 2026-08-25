export type ScheduleMode = "interval" | "daily" | "custom";

/** Models that can be kept warm by a wakeup trigger. */
export interface WakeupModelOption {
  id: string;
  label: string;
  provider: "ANTHROPIC" | "GOOGLE";
}

/** Minimal account info used by the wakeup configuration UI. */
export interface WakeupAccountOption {
  id: string;
  email: string;
  isActive: boolean;
  tokenStatus: "active" | "expired" | "revoked";
}

export interface WakeupConfig {
  enabled: boolean;
  selectedModels: string[];
  selectedAccountIds: string[];
  scheduleMode: ScheduleMode;
  intervalHours: number;
  /** "HH:MM" strings in ascending order. */
  dailyTimes: string[];
  /** Standard 5-field cron expression; null unless scheduleMode is "custom". */
  cronExpression: string | null;
  customPrompt: string;
  maxOutputTokens: number;
  cooldownMinutes: number;
  wakeOnReset: boolean;
  updatedAt?: string;
}
