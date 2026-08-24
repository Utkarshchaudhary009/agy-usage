export interface WakeupModel {
  id: string;
  label: string;
  provider: "anthropic" | "google";
}

// Canonical set of models that can be woken up. These IDs are sent to the
// Cloud Code `streamGenerateContent` endpoint when triggering a model.
export const WAKEUP_MODELS = [
  {
    id: "claude-sonnet-4-5",
    label: "Claude Sonnet 4.5",
    provider: "anthropic",
  },
  { id: "gemini-3-flash", label: "Gemini 3 Flash", provider: "google" },
  { id: "gemini-3-pro-low", label: "Gemini 3 Pro (Low)", provider: "google" },
] as const satisfies readonly WakeupModel[];

const WAKEUP_MODEL_IDS = new Set<string>(WAKEUP_MODELS.map((m) => m.id));

export function isWakeupModelId(value: string): boolean {
  return WAKEUP_MODEL_IDS.has(value);
}

export function getWakeupModelLabel(id: string): string {
  return WAKEUP_MODELS.find((m) => m.id === id)?.label ?? id;
}

export const WAKEUP_PROVIDER_LABELS = {
  anthropic: "Anthropic",
  google: "Google",
} as const satisfies Record<WakeupModel["provider"], string>;

export function getWakeupModelProviderLabel(
  provider: WakeupModel["provider"],
): string {
  return WAKEUP_PROVIDER_LABELS[provider];
}
