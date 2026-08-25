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

/** Outcome of one account/model wakeup request. */
export interface TriggerSingleResult {
  accountId: string;
  modelId: string;
  success: boolean;
  durationMs: number;
  error?: string;
  responsePreview?: string;
}

/** Aggregate outcome of a full executeWakeup() run for one user. */
export interface TriggerAllResult {
  clerkUserId: string;
  results: TriggerSingleResult[];
  skipped: boolean;
  skipReason?: string;
}

/** Cooldown state derived from the config's own cooldown window. */
export interface CooldownStatus {
  onCooldown: boolean;
  lastTriggerAt: string | null;
  cooldownEndsAt: string | null;
}
