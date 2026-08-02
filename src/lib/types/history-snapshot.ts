export interface ModelSnapshot {
  modelId: string;
  remainingPercentage: number;
  isExhausted: boolean;
  modelProvider?: string;
}

export interface PromptCreditsSnapshot {
  available: number;
  monthly: number;
}

export interface SnapshotData {
  models?: ModelSnapshot[];
  promptCredits?: PromptCreditsSnapshot;
}
