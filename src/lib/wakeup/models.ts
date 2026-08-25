import type {
  ScheduleMode,
  WakeupConfig,
  WakeupModelOption,
} from "@/lib/types/wakeup";

/** Models that can be kept warm by a wakeup trigger. */
export const WAKEUP_MODELS = [
  {
    id: "claude-sonnet-4-5",
    label: "Claude Sonnet 4.5",
    provider: "ANTHROPIC",
  },
  { id: "gemini-3-flash", label: "Gemini 3 Flash", provider: "GOOGLE" },
  { id: "gemini-3-pro-low", label: "Gemini 3 Pro (Low)", provider: "GOOGLE" },
] as const satisfies readonly WakeupModelOption[];

const DEFAULT_MODEL_IDS = WAKEUP_MODELS.map((model) => model.id);

const MODEL_ID_SET = new Set<string>(DEFAULT_MODEL_IDS);

/** Narrows untrusted input to a model id that a wakeup request accepts. */
export function isWakeupModelId(value: unknown): value is string {
  return typeof value === "string" && MODEL_ID_SET.has(value);
}

export const SCHEDULE_MODES: {
  value: ScheduleMode;
  label: string;
  description: string;
}[] = [
  {
    value: "interval",
    label: "Interval",
    description: "Trigger every N hours.",
  },
  {
    value: "daily",
    label: "Daily times",
    description: "Trigger at fixed times each day.",
  },
  {
    value: "custom",
    label: "Custom cron",
    description: "Advanced schedule via cron expression.",
  },
];

export function defaultWakeupConfig(): WakeupConfig {
  return {
    enabled: false,
    selectedModels: [...DEFAULT_MODEL_IDS],
    selectedAccountIds: [],
    scheduleMode: "interval",
    intervalHours: 6,
    dailyTimes: ["09:00", "15:00", "21:00"],
    cronExpression: null,
    customPrompt: "hi",
    maxOutputTokens: 1,
    cooldownMinutes: 60,
    wakeOnReset: false,
  };
}
