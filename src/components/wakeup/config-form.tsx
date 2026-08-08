"use client";

import { Clock, Save } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import type {
  WakeupAccount,
  WakeupConfig,
  WakeupConfigInput,
} from "@/lib/types/wakeup";
import { cn, inputClass } from "@/lib/utils";
import { WAKEUP_MODELS } from "@/lib/wakeup/models";
import type { ScheduleMode } from "@/lib/wakeup/schedule-evaluator";
import {
  getNextTriggerTime,
  isDailyTime,
  isValidCronExpression,
} from "@/lib/wakeup/schedule-evaluator";
import { ModelSelector } from "./model-selector";
import { SchedulePicker } from "./schedule-picker";

interface ConfigFormProps {
  config: WakeupConfig | null;
  accounts: WakeupAccount[];
}

function Switch({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  label: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={cn(
        "relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors",
        checked ? "bg-primary" : "bg-muted-foreground/30",
      )}
    >
      <span
        className={cn(
          "inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform",
          checked ? "translate-x-4" : "translate-x-0.5",
        )}
      />
    </button>
  );
}

function accountLabel(account: WakeupAccount): string {
  return account.displayName || account.email || "Unknown account";
}

export function ConfigForm({ config, accounts }: ConfigFormProps) {
  const router = useRouter();

  const [enabled, setEnabled] = useState(config?.enabled ?? false);
  const [selectedModels, setSelectedModels] = useState<string[]>(
    config?.selectedModels ?? WAKEUP_MODELS.map((m) => m.id),
  );
  const [selectedAccountIds, setSelectedAccountIds] = useState<string[]>(
    config?.selectedAccountIds ?? [],
  );
  const [scheduleMode, setScheduleMode] = useState<ScheduleMode>(
    config?.scheduleMode ?? "interval",
  );
  const [intervalHours, setIntervalHours] = useState(
    config?.intervalHours ?? 6,
  );
  const [dailyTimes, setDailyTimes] = useState<string[]>(
    config?.dailyTimes ?? ["09:00", "15:00", "21:00"],
  );
  const [cronExpression, setCronExpression] = useState(
    config?.cronExpression ?? "",
  );
  const [customPrompt, setCustomPrompt] = useState(
    config?.customPrompt ?? "hi",
  );
  const [maxOutputTokens, setMaxOutputTokens] = useState(
    config?.maxOutputTokens ?? 1,
  );
  const [cooldownMinutes, setCooldownMinutes] = useState(
    config?.cooldownMinutes ?? 60,
  );
  const [wakeOnReset, setWakeOnReset] = useState(config?.wakeOnReset ?? false);

  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!config) return;
    setEnabled(config.enabled);
    setSelectedModels(config.selectedModels);
    setSelectedAccountIds(config.selectedAccountIds);
    setScheduleMode(config.scheduleMode);
    setIntervalHours(config.intervalHours);
    setDailyTimes(config.dailyTimes);
    setCronExpression(config.cronExpression ?? "");
    setCustomPrompt(config.customPrompt);
    setMaxOutputTokens(config.maxOutputTokens);
    setCooldownMinutes(config.cooldownMinutes);
    setWakeOnReset(config.wakeOnReset);
  }, [config]);

  // Computed on the client only: `getNextTriggerTime(new Date(), …)` and
  // `toLocaleString()` both depend on the runtime clock/locale, which differ
  // between the server and the hydrating client and would cause a hydration
  // mismatch. The placeholder renders identically on both sides until the effect
  // runs.
  const [nextTrigger, setNextTrigger] = useState("—");

  useEffect(() => {
    const next = getNextTriggerTime(new Date(), {
      scheduleMode,
      intervalHours,
      dailyTimes,
      cronExpression: cronExpression.trim() || null,
    });
    setNextTrigger(next ? next.toLocaleString() : "—");
  }, [scheduleMode, intervalHours, dailyTimes, cronExpression]);

  const cronInvalid =
    scheduleMode === "custom" && !isValidCronExpression(cronExpression.trim());
  const dailyInvalid =
    scheduleMode === "daily" && dailyTimes.some((t) => !isDailyTime(t));
  const canSave =
    selectedModels.length > 0 && !cronInvalid && !dailyInvalid && !saving;

  const toggleAccount = (id: string) => {
    setSelectedAccountIds((prev) =>
      prev.includes(id) ? prev.filter((a) => a !== id) : [...prev, id],
    );
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSave) return;
    setSaving(true);
    const payload: WakeupConfigInput = {
      enabled,
      selectedModels,
      selectedAccountIds,
      scheduleMode,
      intervalHours,
      dailyTimes,
      cronExpression: cronExpression.trim() || null,
      customPrompt,
      maxOutputTokens,
      cooldownMinutes,
      wakeOnReset,
    };

    try {
      const res = await fetch("/api/wakeup/config", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(15_000),
      });
      const json = (await res.json().catch(() => ({}))) as {
        message?: string;
        error?: string;
        config?: WakeupConfig;
      };

      if (!res.ok) {
        toast.error(json.error || json.message || "Failed to save config");
        return;
      }
      toast.success("Wakeup configuration saved");
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to save config");
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={handleSave} className="flex flex-col gap-6">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-4">
          <div>
            <CardTitle>Automatic Wakeup</CardTitle>
            <CardDescription>
              Periodically trigger your models to keep them warm and avoid cold
              starts.
            </CardDescription>
          </div>
          <Switch
            checked={enabled}
            onChange={setEnabled}
            label="Enable automatic wakeup"
          />
        </CardHeader>
        <CardContent>
          <div
            className={cn(
              "flex items-center gap-2 rounded-lg border border-muted bg-muted/30 px-3 py-2 text-sm text-muted-foreground",
              !enabled && "opacity-60",
            )}
          >
            <Clock className="size-4 shrink-0" />
            <span>
              Next trigger:{" "}
              <span className="font-medium text-foreground">{nextTrigger}</span>
            </span>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Models</CardTitle>
          <CardDescription>
            Which models should be triggered during a wakeup run.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ModelSelector value={selectedModels} onChange={setSelectedModels} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Accounts</CardTitle>
          <CardDescription>
            Leave unselected to trigger all of your linked accounts.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {accounts.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No linked accounts. Link a Google account first to enable wakeup.
            </p>
          ) : (
            <div className="grid gap-2 sm:grid-cols-2">
              {accounts.map((account) => {
                const active = selectedAccountIds.includes(account.id);
                return (
                  <label
                    key={account.id}
                    className={cn(
                      "flex cursor-pointer items-center justify-between rounded-lg border px-3 py-2.5 text-left text-sm transition-colors",
                      active
                        ? "border-primary bg-primary/5 ring-1 ring-primary/40"
                        : "border-border bg-background hover:bg-muted",
                    )}
                  >
                    <span className="truncate font-medium">
                      {accountLabel(account)}
                    </span>
                    <span
                      className={cn(
                        "ml-2 flex size-4 shrink-0 items-center justify-center rounded border text-[10px]",
                        active
                          ? "border-primary bg-primary text-primary-foreground"
                          : "border-muted-foreground/40",
                      )}
                    >
                      {active ? "✓" : ""}
                    </span>
                    <input
                      type="checkbox"
                      className="sr-only"
                      checked={active}
                      onChange={() => toggleAccount(account.id)}
                    />
                  </label>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Schedule</CardTitle>
          <CardDescription>
            How often the wakeup run should execute.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <SchedulePicker
            mode={scheduleMode}
            intervalHours={intervalHours}
            dailyTimes={dailyTimes}
            cronExpression={cronExpression}
            onModeChange={setScheduleMode}
            onIntervalChange={setIntervalHours}
            onDailyTimesChange={setDailyTimes}
            onCronChange={setCronExpression}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Trigger Options</CardTitle>
          <CardDescription>
            Fine-tune the request sent to each model.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-2">
              <label htmlFor="custom-prompt" className="text-sm font-medium">
                Prompt
              </label>
              <input
                id="custom-prompt"
                type="text"
                value={customPrompt}
                onChange={(e) => setCustomPrompt(e.target.value)}
                className={inputClass}
              />
            </div>
            <div className="flex flex-col gap-2">
              <label htmlFor="max-tokens" className="text-sm font-medium">
                Max output tokens
              </label>
              <input
                id="max-tokens"
                type="number"
                min={1}
                max={8192}
                value={maxOutputTokens}
                onChange={(e) =>
                  setMaxOutputTokens(Number.parseInt(e.target.value, 10) || 1)
                }
                className={inputClass}
              />
            </div>
          </div>

          <div className="flex flex-col gap-2">
            <label htmlFor="cooldown" className="text-sm font-medium">
              Cooldown (minutes)
            </label>
            <input
              id="cooldown"
              type="number"
              min={1}
              max={1440}
              value={cooldownMinutes}
              onChange={(e) =>
                setCooldownMinutes(Number.parseInt(e.target.value, 10) || 1)
              }
              className={cn(inputClass, "w-40")}
            />
            <p className="text-xs text-muted-foreground">
              Minimum time between wakeup runs to avoid duplicate triggers.
            </p>
          </div>

          <div className="flex items-center justify-between rounded-lg border px-3 py-2.5">
            <div className="flex flex-col">
              <span className="text-sm font-medium">Wake on quota reset</span>
              <span className="text-xs text-muted-foreground">
                Trigger immediately when a model&apos;s quota resets.
              </span>
            </div>
            <Switch
              checked={wakeOnReset}
              onChange={setWakeOnReset}
              label="Wake on quota reset"
            />
          </div>
        </CardContent>
      </Card>

      <div className="flex items-center justify-end gap-3">
        <Button type="submit" disabled={!canSave}>
          <Save />
          {saving ? "Saving…" : "Save Configuration"}
        </Button>
      </div>
    </form>
  );
}
