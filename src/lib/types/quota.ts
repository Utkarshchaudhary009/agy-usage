export interface QuotaSnapshot {
  timestamp: string;
  method: "google";
  email: string;
  accountId: string;
  promptCredits?: PromptCreditsInfo;
  models: ModelQuotaInfo[];
  planType?: string;
}

export interface ModelQuotaInfo {
  modelId: string;
  label: string;
  displayName: string;
  remainingPercentage: number; // 0.0 to 1.0
  isExhausted: boolean;
  resetTime?: string; // ISO date
  timeUntilResetMs?: number;
  isAutocompleteOnly?: boolean;
  modelProvider?: string; // 'ANTHROPIC' | 'GOOGLE' etc.
  supportsThinking?: boolean;
}

export interface PromptCreditsInfo {
  available: number;
  monthly: number;
  usedPercentage: number;
  remainingPercentage: number;
}
