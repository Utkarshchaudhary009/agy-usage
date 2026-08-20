"use client";

import { Check, Clock, Link2, Save, TriangleAlert } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import type { WakeupConfig, WakeupScheduleMode } from "@/lib/types/wakeup";
import { describeSchedule, nextTriggerPreview } from "@/lib/wakeup/schedule";
import { ModelSelector } from "./model-selector";
import { SchedulePicker } from "./schedule-picker";

export interface WakeupAccountOption {
  id: string;
  email: string;
  isActive: boolean;
}

interface ConfigFormProps {
  initialConfig: WakeupConfig;
  accounts: WakeupAccountOption[];
}

export function WakeupConfigForm({ initialConfig, accounts }: ConfigFormProps) {
  const router = useRouter();
  const [config, setConfig] = useState<WakeupConfig>(initialConfig);
  const [saving, setSaving] = useState(false);

  const patch = (partial: Partial<WakeupConfig>) =>
    setConfig((prev) => ({ ...prev, ...partial }));

  const selectedAccounts = new Set(config.selectedAccountIds);
  const toggleAccount = (id: string, checked: boolean) => {
    const next = new Set(selectedAccounts);
    if (checked) next.add(id);
    else next.delete(id);
    patch({ selectedAccountIds: Array.from(next) });
  };

  const scheduleSummary = describeSchedule(config);
  const nextRun = nextTriggerPreview(config);

  const handleSave = async () => {
    setSaving(true);
    try {
      const res = await fetch("/api/wakeup/config", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(config),
      });
      const json = (await res.json().catch(() => ({}))) as {
        config?: WakeupConfig;
        message?: string;
        error?: string;
        errors?: Record<string, string>;
      };

      if (!res.ok) {
        const firstError = json.errors
          ? Object.values(json.errors)[0]
          : json.message || json.error;
        toast.error(firstError ?? "Failed to save configuration");
        return;
      }

      if (json.config) setConfig(json.config);
      toast.success("Wakeup configuration saved");
      router.refresh();
    } catch {
      toast.error("Network error while saving configuration");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex flex-col gap-6">
      {/* Enable + summary */}
      <div className="flex flex-col gap-4 rounded-xl bg-card p-4 ring-1 ring-foreground/10 sm:flex-row sm:items-center sm:justify-between">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <Switch
              checked={config.enabled}
              onCheckedChange={(c) => patch({ enabled: c === true })}
              id="wakeup-enabled"
            />
            <Label htmlFor="wakeup-enabled" className="text-base">
              Auto-wakeup {config.enabled ? "enabled" : "disabled"}
            </Label>
          </div>
          <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
            <Clock className="size-3.5" />
            {scheduleSummary}
            {nextRun && config.enabled && (
              <span className="text-foreground/70">
                · next ~
                {nextRun.toLocaleString([], {
                  month: "short",
                  day: "numeric",
                  hour: "2-digit",
                  minute: "2-digit",
                })}
              </span>
            )}
          </p>
        </div>
        <Button onClick={handleSave} disabled={saving}>
          {saving ? <Clock className="animate-spin" /> : <Save />}
          {saving ? "Saving..." : "Save configuration"}
        </Button>
      </div>

      <fieldset
        disabled={!config.enabled}
        className="flex flex-col gap-6 disabled:opacity-60"
      >
        {/* Models */}
        <section className="space-y-3">
          <div>
            <h2 className="text-sm font-semibold">Models to wake up</h2>
            <p className="text-sm text-muted-foreground">
              Each selected model is triggered on the schedule to keep it warm.
            </p>
          </div>
          <ModelSelector
            value={config.selectedModels}
            onChange={(next) => patch({ selectedModels: next })}
          />
        </section>

        {/* Accounts */}
        <section className="space-y-3">
          <div>
            <h2 className="text-sm font-semibold">Linked accounts</h2>
            <p className="text-sm text-muted-foreground">
              Which accounts to trigger. Leave all unchecked to use every
              account.
            </p>
          </div>
          {accounts.length === 0 ? (
            <div className="flex items-center gap-2 rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
              <Link2 className="size-4" />
              No Google accounts linked yet.{" "}
              <a href="/accounts" className="text-primary underline">
                Link an account
              </a>
              .
            </div>
          ) : (
            <div className="grid gap-2 sm:grid-cols-2">
              {accounts.map((account) => {
                const accountId = `account-${account.id}`;
                return (
                  <div
                    key={account.id}
                    className="flex items-center gap-3 rounded-lg border border-border p-3 hover:bg-muted/50"
                  >
                    <Checkbox
                      id={accountId}
                      checked={selectedAccounts.has(account.id)}
                      onCheckedChange={(c) =>
                        toggleAccount(account.id, c === true)
                      }
                    />
                    <Label
                      htmlFor={accountId}
                      className="flex flex-1 cursor-pointer flex-col"
                    >
                      <span className="text-sm font-medium">
                        {account.email}
                      </span>
                      {account.isActive && (
                        <span className="text-xs text-muted-foreground">
                          Active account
                        </span>
                      )}
                    </Label>
                  </div>
                );
              })}
            </div>
          )}
        </section>

        {/* Schedule */}
        <section className="space-y-3">
          <div>
            <h2 className="text-sm font-semibold">Schedule</h2>
            <p className="text-sm text-muted-foreground">
              How often the wakeup runs.
            </p>
          </div>
          <SchedulePicker
            mode={config.scheduleMode as WakeupScheduleMode}
            intervalHours={config.intervalHours}
            dailyTimes={config.dailyTimes}
            cronExpression={config.cronExpression}
            onModeChange={(m) => patch({ scheduleMode: m })}
            onIntervalChange={(h) => patch({ intervalHours: h })}
            onDailyTimesChange={(t) => patch({ dailyTimes: t })}
            onCronChange={(e) => patch({ cronExpression: e || null })}
          />
        </section>

        {/* Advanced */}
        <section className="space-y-4">
          <div>
            <h2 className="text-sm font-semibold">Advanced</h2>
            <p className="text-sm text-muted-foreground">
              Fine-tune token usage and behavior.
            </p>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="max-tokens">Max output tokens</Label>
              <Input
                id="max-tokens"
                type="number"
                min={1}
                max={8192}
                value={config.maxOutputTokens}
                onChange={(e) =>
                  patch({ maxOutputTokens: Number(e.target.value) || 1 })
                }
              />
              <p className="text-xs text-muted-foreground">
                Kept low (1) to minimize token usage on each trigger.
              </p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="cooldown">Cooldown (minutes)</Label>
              <Input
                id="cooldown"
                type="number"
                min={0}
                max={1440}
                value={config.cooldownMinutes}
                onChange={(e) =>
                  patch({ cooldownMinutes: Number(e.target.value) || 0 })
                }
              />
              <p className="text-xs text-muted-foreground">
                Minimum gap between scheduled runs to avoid overlapping
                triggers.
              </p>
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="prompt">Custom prompt</Label>
            <Textarea
              id="prompt"
              value={config.customPrompt}
              onChange={(e) => patch({ customPrompt: e.target.value })}
              rows={2}
              placeholder="hi"
            />
          </div>

          <label
            htmlFor="wake-on-reset"
            className="flex items-center gap-3 rounded-lg border border-border p-3"
          >
            <Switch
              checked={config.wakeOnReset}
              onCheckedChange={(c) => patch({ wakeOnReset: c === true })}
              id="wake-on-reset"
            />
            <span className="flex flex-col">
              <span className="text-sm font-medium">Wake on quota reset</span>
              <span className="text-xs text-muted-foreground">
                Automatically trigger when a model's quota resets to 100%.
              </span>
            </span>
          </label>
        </section>
      </fieldset>

      {config.enabled &&
        config.selectedModels.length === 0 &&
        accounts.length > 0 && (
          <div className="flex items-center gap-2 rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
            <TriangleAlert className="size-4" />
            Select at least one model to enable wakeup.
          </div>
        )}

      {config.enabled && accounts.length > 0 && (
        <div className="flex justify-end">
          <Button onClick={handleSave} disabled={saving}>
            {saving ? <Clock className="animate-spin" /> : <Check />}
            {saving ? "Saving..." : "Save configuration"}
          </Button>
        </div>
      )}
    </div>
  );
}
