export interface LoadCodeAssistResponse {
  codeAssistEnabled?: boolean;
  planInfo?: {
    monthlyPromptCredits?: number;
    planType?: string;
  };
  availablePromptCredits?: number;
  cloudaicompanionProject?: string | { id?: string };
  currentTier?: {
    id?: string;
    name?: string;
    description?: string;
  };
  paidTier?: {
    id?: string;
  };
  allowedTiers?: Array<{ id?: string; isDefault?: boolean }>;
}

export interface ModelInfo {
  displayName?: string;
  model?: string;
  label?: string;
  quotaInfo?: {
    remainingFraction?: number;
    resetTime?: string;
    isExhausted?: boolean;
  };
  maxTokens?: number;
  recommended?: boolean;
  supportsImages?: boolean;
  supportsThinking?: boolean;
  modelProvider?: string;
}

export interface FetchAvailableModelsResponse {
  models?: Record<string, ModelInfo>;
  defaultAgentModelId?: string;
}

export type OnboardResponse = Record<string, unknown>;

export interface GenerateResponse {
  text: string;
  tokensUsed?: {
    prompt: number;
    completion: number;
    total: number;
  };
}
