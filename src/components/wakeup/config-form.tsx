"use client";

import { Clock, Loader2 } from "lucide-react";
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
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import type { WakeupConfig } from "@/lib/types/wakeup";
import { cn } from "@/lib/utils";
import { computeNextTrigger, describeSchedule } from "@/lib/wakeup/schedule";
import { ModelSelector } from "./model-selector";
import { SchedulePicker } from "./schedule-picker";

export interface LinkedAccountOption {
  id: string;
  email: string;
  displayName: string | null;
}

interface ConfigFormProps {
  initialConfig: WakeupConfig;
  accounts: LinkedAccountOption[];
}

function formatNextTrigger(date: Date | null): string {
  if (!date) return "Custom schedule";
  return date.toLocaleString(undefined, {
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    month: "short",
    day: "numeric",
  });
}

export function ConfigForm({ initialConfig, accounts }: ConfigFormProps) {
  const [config, setConfig] = useState<WakeupConfig>(initialConfig);
  const [isSaving, setIsSaving] = useState(false);
  // The "next trigger" preview is derived from the current time, so it is only
  // computed after mount to avoid an SSR/client hydration mismatch.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const update = (patch: Partial<WakeupConfig>) =>
    setConfig((prev) => ({ ...prev, ...patch }));

  const toggleAccount = (id: string) => {
    setConfig((prev) => ({
      ...prev,
      selectedAccountIds: prev.selectedAccountIds.includes(id)
        ? prev.selectedAccountIds.filter((a) => a !== id)
        : [...prev.selectedAccountIds, id],
    }));
  };

  const nextTrigger =
    mounted && config.enabled ? computeNextTrigger(config) : null;

  const handleSave = async () => {
    setIsSaving(true);
    try {
      const res = await fetch("/api/wakeup/config", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(config),
      });

      const data = await res.json();
      if (!res.ok) {
        toast.error(data?.message ?? "Failed to save configuration.");
        return;
      }

      setConfig(data.config as WakeupConfig);
      toast.success("Wakeup configuration saved.");
    } catch {
      toast.error("Network error. Please try again.");
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeader className="flex-row items-start justify-between gap-4">
          <div className="space-y-1">
            <CardTitle>Wakeup Engine</CardTitle>
            <CardDescription>
              Automatically trigger models to keep them warm and avoid quota
              cool-down. Runs in the background via scheduled jobs.
            </CardDescription>
          </div>
          <div className="flex items-center gap-2 pt-1">
            <span className="text-sm text-muted-foreground">
              {config.enabled ? "Enabled" : "Disabled"}
            </span>
            <Switch
              checked={config.enabled}
              onCheckedChange={(checked) => update({ enabled: checked })}
              aria-label="Enable wakeup engine"
            />
          </div>
        </CardHeader>
        <CardContent>
          <div
            className={cn(
              "flex items-center gap-2 rounded-lg border border-border bg-muted/40 p-3 text-sm",
              !config.enabled && "opacity-60",
            )}
          >
            <Clock className="size-4 text-muted-foreground" />
            <span className="text-muted-foreground">Next trigger:</span>
            <span className="font-medium">
              {config.enabled ? formatNextTrigger(nextTrigger) : "—"}
            </span>
            <span className="text-muted-foreground">
              ({describeSchedule(config)})
            </span>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Models</CardTitle>
          <CardDescription>
            Choose which models to trigger for each selected account.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ModelSelector
            selected={config.selectedModels}
            onChange={(models) => update({ selectedModels: models })}
            disabled={!config.enabled}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Accounts</CardTitle>
          <CardDescription>
            Select which linked Google accounts to wake up. If none are
            selected, all of your accounts will be used.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {accounts.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No linked accounts. Link a Google account from the Accounts page
              first.
            </p>
          ) : (
            <div className="grid gap-2 sm:grid-cols-2">
              {accounts.map((account) => {
                const checked = config.selectedAccountIds.includes(account.id);
                return (
                  <label
                    key={account.id}
                    className={cn(
                      "flex cursor-pointer items-center gap-3 rounded-lg border p-3 text-sm transition-colors",
                      checked
                        ? "border-primary bg-primary/5"
                        : "border-border hover:bg-muted",
                      !config.enabled && "pointer-events-none opacity-50",
                    )}
                  >
                    <input
                      type="checkbox"
                      className="size-4 rounded border-input accent-primary"
                      checked={checked}
                      onChange={() => toggleAccount(account.id)}
                    />
                    <span className="font-medium">
                      {account.displayName ?? account.email}
                    </span>
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
          <CardDescription>Control how often the wakeup runs.</CardDescription>
        </CardHeader>
        <CardContent>
          <SchedulePicker
            config={config}
            onChange={update}
            disabled={!config.enabled}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Trigger Options</CardTitle>
          <CardDescription>
            Fine-tune the prompt and throttling behavior.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <label className="text-sm font-medium" htmlFor="custom-prompt">
              Prompt
            </label>
            <Input
              id="custom-prompt"
              value={config.customPrompt}
              disabled={!config.enabled}
              onChange={(e) => update({ customPrompt: e.target.value })}
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <label
                className="text-sm font-medium"
                htmlFor="max-output-tokens"
              >
                Max output tokens
              </label>
              <Input
                id="max-output-tokens"
                type="number"
                min={1}
                max={4096}
                value={config.maxOutputTokens}
                disabled={!config.enabled}
                onChange={(e) =>
                  update({ maxOutputTokens: Number(e.target.value) })
                }
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium" htmlFor="cooldown-minutes">
                Cooldown (minutes)
              </label>
              <Input
                id="cooldown-minutes"
                type="number"
                min={1}
                max={1440}
                value={config.cooldownMinutes}
                disabled={!config.enabled}
                onChange={(e) =>
                  update({ cooldownMinutes: Number(e.target.value) })
                }
              />
            </div>
          </div>

          <div className="flex items-center justify-between gap-4 rounded-lg border p-3 text-sm">
            <span>
              <span className="font-medium">Wake on quota reset</span>
              <span className="block text-xs text-muted-foreground">
                Automatically trigger when a model&apos;s quota resets.
              </span>
            </span>
            <Switch
              checked={config.wakeOnReset}
              disabled={!config.enabled}
              onCheckedChange={(checked) => update({ wakeOnReset: checked })}
              aria-label="Wake on quota reset"
            />
          </div>
        </CardContent>
      </Card>

      <div className="flex justify-end">
        <Button onClick={handleSave} disabled={isSaving}>
          {isSaving && <Loader2 className="size-4 animate-spin" />}
          {isSaving ? "Saving..." : "Save configuration"}
        </Button>
      </div>
    </div>
  );
}
