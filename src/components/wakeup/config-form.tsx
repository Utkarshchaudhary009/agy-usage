"use client";

import { Loader2, Save } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import type { WakeupConfig, WakeupConfigFormData } from "@/lib/types/wakeup";
import { ModelSelector } from "./model-selector";
import { SchedulePicker } from "./schedule-picker";

interface ConfigFormProps {
  initialConfig: WakeupConfig | null;
}

const DEFAULT_FORM_DATA: WakeupConfigFormData = {
  enabled: false,
  selectedModels: ["claude-sonnet-4-5", "gemini-3-flash", "gemini-3-pro-low"],
  selectedAccountIds: [],
  scheduleMode: "interval",
  intervalHours: 6,
  dailyTimes: ["09:00", "15:00", "21:00"],
  cronExpression: "",
  customPrompt: "hi",
  maxOutputTokens: 1,
  cooldownMinutes: 60,
  wakeOnReset: false,
};

function configToFormData(config: WakeupConfig | null): WakeupConfigFormData {
  if (!config) return { ...DEFAULT_FORM_DATA };
  return {
    enabled: config.enabled,
    selectedModels: config.selectedModels,
    selectedAccountIds: config.selectedAccountIds,
    scheduleMode: config.scheduleMode,
    intervalHours: config.intervalHours,
    dailyTimes: config.dailyTimes,
    cronExpression: config.cronExpression ?? "",
    customPrompt: config.customPrompt,
    maxOutputTokens: config.maxOutputTokens,
    cooldownMinutes: config.cooldownMinutes,
    wakeOnReset: config.wakeOnReset,
  };
}

export function WakeupConfigForm({ initialConfig }: ConfigFormProps) {
  const [formData, setFormData] = useState<WakeupConfigFormData>(
    configToFormData(initialConfig),
  );
  const [saving, setSaving] = useState(false);

  const update = <K extends keyof WakeupConfigFormData>(
    key: K,
    value: WakeupConfigFormData[K],
  ) => {
    setFormData((prev) => ({ ...prev, [key]: value }));
  };

  const toggleModel = (model: string) => {
    setFormData((prev) => ({
      ...prev,
      selectedModels: prev.selectedModels.includes(model)
        ? prev.selectedModels.filter((m) => m !== model)
        : [...prev.selectedModels, model],
    }));
  };

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);

    try {
      const res = await fetch("/api/wakeup/config", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(formData),
      });

      const json = await res.json();

      if (!res.ok) {
        toast.error(json.message || "Failed to save config.");
        return;
      }

      toast.success("Wakeup config saved.");
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Failed to save config.",
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-6">
      <div className="flex items-center justify-between rounded-lg border bg-card p-4">
        <div>
          <h2 className="text-base font-semibold">Enable Wakeup</h2>
          <p className="text-sm text-muted-foreground">
            Automatically trigger wakeup calls on a schedule to keep models
            warm.
          </p>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={formData.enabled}
          onClick={() => update("enabled", !formData.enabled)}
          className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${formData.enabled ? "bg-primary" : "bg-muted"}`}
        >
          <span
            className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${formData.enabled ? "translate-x-6" : "translate-x-1"}`}
          />
        </button>
      </div>

      <ModelSelector
        selectedModels={formData.selectedModels}
        onToggleModel={toggleModel}
      />

      <SchedulePicker
        scheduleMode={formData.scheduleMode}
        intervalHours={formData.intervalHours}
        dailyTimes={formData.dailyTimes}
        cronExpression={formData.cronExpression}
        onModeChange={(mode) => update("scheduleMode", mode)}
        onIntervalChange={(hours) => update("intervalHours", hours)}
        onDailyTimesChange={(times) => update("dailyTimes", times)}
        onCronChange={(expr) => update("cronExpression", expr)}
      />

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="flex flex-col gap-2">
          <label htmlFor="customPrompt" className="text-sm font-medium">
            Custom Prompt
          </label>
          <input
            id="customPrompt"
            type="text"
            value={formData.customPrompt}
            onChange={(e) => update("customPrompt", e.target.value)}
            className="rounded-lg border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
            placeholder="e.g. hi"
          />
        </div>
        <div className="flex flex-col gap-2">
          <label htmlFor="maxOutputTokens" className="text-sm font-medium">
            Max Output Tokens
          </label>
          <input
            id="maxOutputTokens"
            type="number"
            min={1}
            max={10000}
            value={formData.maxOutputTokens}
            onChange={(e) =>
              update("maxOutputTokens", parseInt(e.target.value, 10) || 1)
            }
            className="rounded-lg border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
          />
        </div>
        <div className="flex flex-col gap-2">
          <label htmlFor="cooldownMinutes" className="text-sm font-medium">
            Cooldown (minutes)
          </label>
          <input
            id="cooldownMinutes"
            type="number"
            min={1}
            max={1440}
            value={formData.cooldownMinutes}
            onChange={(e) =>
              update("cooldownMinutes", parseInt(e.target.value, 10) || 60)
            }
            className="rounded-lg border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
          />
        </div>
        <div className="flex flex-col gap-2">
          <label className="text-sm font-medium" htmlFor="wakeOnReset">
            Wake on Reset
          </label>
          <button
            id="wakeOnReset"
            type="button"
            role="switch"
            aria-checked={formData.wakeOnReset}
            onClick={() => update("wakeOnReset", !formData.wakeOnReset)}
            className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${formData.wakeOnReset ? "bg-primary" : "bg-muted"} self-start`}
          >
            <span
              className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${formData.wakeOnReset ? "translate-x-6" : "translate-x-1"}`}
            />
          </button>
          <span className="text-xs text-muted-foreground">
            Auto-trigger when a quota reset is detected
          </span>
        </div>
      </div>

      <div className="flex justify-end">
        <Button type="submit" disabled={saving}>
          {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          <Save className="mr-2 h-4 w-4" />
          Save Config
        </Button>
      </div>
    </form>
  );
}
