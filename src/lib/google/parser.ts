import "server-only";

import type {
  FetchAvailableModelsResponse,
  LoadCodeAssistResponse,
  ModelInfo,
} from "../types/cloudcode";
import type {
  ModelQuotaInfo,
  PromptCreditsInfo,
  QuotaSnapshot,
} from "../types/quota";

/**
 * Parse reset time string to milliseconds until reset
 */
function parseResetTime(resetTime?: string): number | undefined {
  if (!resetTime) return undefined;

  const resetDate = new Date(resetTime);
  if (Number.isNaN(resetDate.getTime())) {
    return undefined;
  }

  const now = Date.now();
  const diff = resetDate.getTime() - now;
  return diff > 0 ? diff : undefined;
}

function isAutocompleteModel(modelId: string, displayName: string): boolean {
  return (
    modelId.includes("autocomplete") ||
    displayName.toLowerCase().includes("autocomplete") ||
    // Keep legacy check for gemini-2.5 but narrow it down if possible
    modelId.includes("gemini-2.5-autocomplete")
  );
}

/**
 * Check if a model should be shown in quota display
 * Filter out internal models and only show recommended ones
 */
function shouldShowModel(
  modelId: string,
  model: ModelInfo,
  includeAutocomplete: boolean,
): boolean {
  // Skip internal models
  if (modelId.startsWith("chat_") || modelId.startsWith("tab_")) {
    return false;
  }
  // Skip image generation models
  if (modelId.includes("image")) {
    return false;
  }
  // Skip internal/experimental models
  if (modelId.startsWith("rev")) {
    return false;
  }
  // Skip lite models that are just for specific features
  if (modelId.includes("mquery") || modelId.includes("lite")) {
    return false;
  }
  // Only show models with quota info
  if (!model.quotaInfo) {
    return false;
  }

  // Filter out autocomplete models unless explicitly requested
  if (!includeAutocomplete) {
    if (isAutocompleteModel(modelId, model.displayName || "")) {
      return false;
    }
  }

  return true;
}

/**
 * Parse model info into ModelQuotaInfo
 */
function parseModelInfo(modelId: string, model: ModelInfo): ModelQuotaInfo {
  const quotaInfo = model.quotaInfo;

  let label = model.label || model.displayName || modelId;
  // Strip common prefixes
  if (label.startsWith("Gemini ") && label !== "Gemini") {
    label = label.substring("Gemini ".length);
  }
  if (label.startsWith("Claude ") && label !== "Claude") {
    label = label.substring("Claude ".length);
  }

  return {
    modelId: modelId,
    label: label,
    displayName: model.displayName || model.label || modelId,
    remainingPercentage: quotaInfo?.remainingFraction ?? 0,
    isExhausted: quotaInfo?.isExhausted ?? quotaInfo?.remainingFraction === 0,
    resetTime: quotaInfo?.resetTime,
    timeUntilResetMs: parseResetTime(quotaInfo?.resetTime),
    isAutocompleteOnly: isAutocompleteModel(modelId, model.displayName || ""),
    modelProvider: model.modelProvider,
    supportsThinking: model.supportsThinking,
  };
}

/**
 * Parse prompt credits from loadCodeAssist response
 */
function parsePromptCredits(
  response: LoadCodeAssistResponse,
): PromptCreditsInfo | undefined {
  const monthly = response.planInfo?.monthlyPromptCredits;
  const available = response.availablePromptCredits;

  if (monthly === undefined || available === undefined) {
    return undefined;
  }

  const used = monthly - available;
  let usedPercentage = monthly > 0 ? used / monthly : 0;
  let remainingPercentage = monthly > 0 ? available / monthly : 0;

  // Clamp percentages to 0.0 - 1.0
  usedPercentage = Math.max(0, Math.min(1, usedPercentage));
  remainingPercentage = Math.max(0, Math.min(1, remainingPercentage));

  return {
    available,
    monthly,
    usedPercentage,
    remainingPercentage,
  };
}

/**
 * Parse API responses into a QuotaSnapshot
 */
export function parseQuotaSnapshot(
  codeAssistResponse: LoadCodeAssistResponse,
  modelsResponse: FetchAvailableModelsResponse,
  email: string,
  accountId: string,
  includeAutocomplete = false,
): QuotaSnapshot {
  const promptCredits = parsePromptCredits(codeAssistResponse);
  const planType = codeAssistResponse.planInfo?.planType;

  const modelsMap = modelsResponse.models || {};
  const models: ModelQuotaInfo[] = [];

  for (const [modelId, modelInfo] of Object.entries(modelsMap)) {
    if (shouldShowModel(modelId, modelInfo, includeAutocomplete)) {
      models.push(parseModelInfo(modelId, modelInfo));
    }
  }

  // Sort by displayName
  models.sort((a, b) => a.displayName.localeCompare(b.displayName));

  return {
    timestamp: new Date().toISOString(),
    method: "google",
    email,
    accountId,
    planType,
    promptCredits,
    models,
  };
}
