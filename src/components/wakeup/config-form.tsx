"use client";

import { Clock, Loader2, Save, Zap } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { ModelSelector } from "@/components/wakeup/model-selector";
import { SchedulePicker } from "@/components/wakeup/schedule-picker";
import type { WakeupConfig } from "@/lib/types/wakeup";
import {
  describeSchedule,
  formatNextTrigger,
  getNextTriggerTime,
} from "@/lib/wakeup/schedule-evaluator";

export interface AccountOption {
  id: string;
  email: string;
  displayName: string | null;
  tokenStatus: "active" | "expired" | "revoked";
}

interface ConfigFormProps {
  initialConfig: WakeupConfig;
  accounts: AccountOption[];
}

export function ConfigForm({ initialConfig, accounts }: ConfigFormProps) {
  const [config, setConfig] = useState<WakeupConfig>(initialConfig);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const patch = (changes: Partial<WakeupConfig>) =>
    setConfig((prev) => ({ ...prev, ...changes }));

  const nextTrigger = useMemo(() => getNextTriggerTime(config), [config]);
  const scheduleSummary = useMemo(
    () =>
      describeSchedule(config.scheduleMode, {
        intervalHours: config.intervalHours,
        dailyTimes: config.dailyTimes,
        cronExpression: config.cronExpression,
      }),
    [config],
  );

  const hasAccounts = accounts.length > 0;
  const selectedAccountCount = config.selectedAccountIds.length;

  async function handleSave() {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/wakeup/config", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(config),
      });
      const json = await res.json();
      if (!res.ok) {
        throw new Error(json.message || json.error || "Failed to save config.");
      }
      setConfig(json.config as WakeupConfig);
      toast.success("Wakeup schedule saved.");
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Failed to save config.";
      setError(message);
      toast.error(message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-2">
              <Zap className="size-5 text-primary" />
              <CardTitle>Auto-Wakeup</CardTitle>
            </div>
            <div className="flex items-center gap-2">
              <Label htmlFor="enabled" className="cursor-pointer">
                {config.enabled ? "Enabled" : "Disabled"}
              </Label>
              <Switch
                id="enabled"
                checked={config.enabled}
                onCheckedChange={(c) => patch({ enabled: c === true })}
              />
            </div>
          </div>
          <CardDescription>
            Periodically prompt your models so they stay warm and ready. Runs in
            the background via scheduled jobs.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="flex items-center gap-2 rounded-lg bg-muted/50 px-3 py-2 text-sm">
            <Clock className="size-4 text-muted-foreground" />
            <span className="text-muted-foreground">
              {config.enabled && hasAccounts && selectedAccountCount > 0
                ? `Next trigger: ${formatNextTrigger(nextTrigger)} (${scheduleSummary})`
                : "Enable and select at least one account to schedule wakeups."}
            </span>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Accounts</CardTitle>
          <CardDescription>
            Which linked Google accounts should be woken up.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {hasAccounts ? (
            <div className="grid gap-2 sm:grid-cols-2">
              {accounts.map((account) => {
                const checked = config.selectedAccountIds.includes(account.id);
                return (
                  <label
                    key={account.id}
                    htmlFor={`account-${account.id}`}
                    className="flex cursor-pointer items-center gap-3 rounded-lg border border-border bg-background p-3 hover:bg-muted/50"
                  >
                    <Checkbox
                      id={`account-${account.id}`}
                      checked={checked}
                      onCheckedChange={(c) =>
                        patch({
                          selectedAccountIds:
                            c === true
                              ? [...config.selectedAccountIds, account.id]
                              : config.selectedAccountIds.filter(
                                  (id) => id !== account.id,
                                ),
                        })
                      }
                      aria-label={`Select ${account.email}`}
                    />
                    <div className="flex flex-col">
                      <span className="text-sm font-medium">
                        {account.displayName ?? account.email}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {account.email}
                      </span>
                    </div>
                  </label>
                );
              })}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              No Google accounts linked yet.{" "}
              <a href="/accounts" className="text-primary underline">
                Link an account
              </a>{" "}
              to enable wakeups.
            </p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Models</CardTitle>
          <CardDescription>Select the models to keep warm.</CardDescription>
        </CardHeader>
        <CardContent>
          <ModelSelector
            value={config.selectedModels}
            onChange={(models) => patch({ selectedModels: models })}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Schedule</CardTitle>
          <CardDescription>How often wakeups should run.</CardDescription>
        </CardHeader>
        <CardContent>
          <SchedulePicker
            value={{
              scheduleMode: config.scheduleMode,
              intervalHours: config.intervalHours,
              dailyTimes: config.dailyTimes,
              cronExpression: config.cronExpression,
            }}
            onChange={(p) =>
              patch({
                scheduleMode: p.scheduleMode ?? config.scheduleMode,
                intervalHours: p.intervalHours ?? config.intervalHours,
                dailyTimes: p.dailyTimes ?? config.dailyTimes,
                cronExpression:
                  p.cronExpression !== undefined
                    ? p.cronExpression
                    : config.cronExpression,
              })
            }
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Trigger Details</CardTitle>
          <CardDescription>
            What gets sent to the model and how often it can repeat.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <Label htmlFor="prompt">Prompt</Label>
            <Textarea
              id="prompt"
              rows={2}
              value={config.customPrompt}
              onChange={(e) => patch({ customPrompt: e.target.value })}
              placeholder="hi"
            />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-2">
              <Label htmlFor="maxTokens">Max output tokens</Label>
              <Input
                id="maxTokens"
                type="number"
                min={1}
                max={8192}
                value={config.maxOutputTokens}
                onChange={(e) =>
                  patch({
                    maxOutputTokens: Number.parseInt(e.target.value, 10) || 1,
                  })
                }
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="cooldown">Cooldown (minutes)</Label>
              <Input
                id="cooldown"
                type="number"
                min={0}
                max={1440}
                value={config.cooldownMinutes}
                onChange={(e) =>
                  patch({
                    cooldownMinutes: Number.parseInt(e.target.value, 10) || 0,
                  })
                }
              />
            </div>
          </div>
          <div className="flex items-center gap-3">
            <Switch
              checked={config.wakeOnReset}
              onCheckedChange={(c) => patch({ wakeOnReset: c === true })}
            />
            <span className="text-sm">
              Trigger immediately when a model&apos;s quota resets
            </span>
          </div>
        </CardContent>
      </Card>

      {error && (
        <p className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      )}

      <div className="flex justify-end">
        <Button onClick={handleSave} disabled={saving} size="lg">
          {saving ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <Save className="size-4" />
          )}
          Save schedule
        </Button>
      </div>
    </div>
  );
}
