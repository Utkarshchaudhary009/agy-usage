"use client";

import { Loader2, Save } from "lucide-react";
import { useState } from "react";
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
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import { DEFAULT_WAKEUP_CONFIG, type WakeupConfig } from "@/lib/types/wakeup";
import { ModelSelector } from "./model-selector";
import { SchedulePicker } from "./schedule-picker";

interface LinkedAccountOption {
  id: string;
  email: string;
}

interface ConfigFormProps {
  initialConfig: WakeupConfig;
  accounts: LinkedAccountOption[];
}

export function ConfigForm({ initialConfig, accounts }: ConfigFormProps) {
  const [config, setConfig] = useState<WakeupConfig>(initialConfig);
  const [saving, setSaving] = useState(false);

  function patch(part: Partial<WakeupConfig>) {
    setConfig((prev) => ({ ...prev, ...part }));
  }

  function toggleAccount(id: string, checked: boolean) {
    if (checked) {
      patch({
        selectedAccountIds: Array.from(
          new Set([...config.selectedAccountIds, id]),
        ),
      });
    } else {
      patch({
        selectedAccountIds: config.selectedAccountIds.filter((a) => a !== id),
      });
    }
  }

  async function handleSave() {
    setSaving(true);
    try {
      const res = await fetch("/api/wakeup/config", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(config),
      });

      const data = await res.json();
      if (!res.ok) {
        toast.error(data.message ?? "Could not save configuration.");
        return;
      }
      if (data.config) setConfig(data.config);
      toast.success("Wakeup configuration saved.");
    } catch {
      toast.error("Network error while saving configuration.");
    } finally {
      setSaving(false);
    }
  }

  function handleReset() {
    setConfig(DEFAULT_WAKEUP_CONFIG);
  }

  const hasAccounts = accounts.length > 0;

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div className="space-y-1">
            <CardTitle>Wakeup</CardTitle>
            <CardDescription>
              Automatically keep selected models warm by triggering a tiny
              request on a schedule.
            </CardDescription>
          </div>
          <div className="flex items-center gap-2">
            <Label htmlFor="enabled" className="cursor-pointer">
              {config.enabled ? "Enabled" : "Disabled"}
            </Label>
            <Switch
              id="enabled"
              checked={config.enabled}
              onCheckedChange={(v) => patch({ enabled: v === true })}
            />
          </div>
        </CardHeader>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Models</CardTitle>
          <CardDescription>Choose which models to keep active.</CardDescription>
        </CardHeader>
        <CardContent>
          <ModelSelector
            selected={config.selectedModels}
            onChange={(models) => patch({ selectedModels: models })}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Accounts</CardTitle>
          <CardDescription>
            Wakeup will run across the selected linked accounts. Leave empty to
            use all active accounts.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {hasAccounts ? (
            <div className="grid gap-2 sm:grid-cols-2">
              {accounts.map((account) => {
                const checked = config.selectedAccountIds.includes(account.id);
                const id = `account-${account.id}`;
                return (
                  <div
                    key={account.id}
                    className="flex items-center gap-3 rounded-lg border border-border bg-card px-3 py-2"
                  >
                    <input
                      type="checkbox"
                      id={id}
                      className="peer sr-only"
                      checked={checked}
                      onChange={(e) =>
                        toggleAccount(account.id, e.target.checked)
                      }
                    />
                    <Label
                      htmlFor={id}
                      className="flex cursor-pointer items-center gap-2 font-normal"
                    >
                      <span
                        className={`flex size-4 items-center justify-center rounded-[4px] border ${
                          checked
                            ? "border-primary bg-primary text-primary-foreground"
                            : "border-input"
                        }`}
                      >
                        {checked ? (
                          <svg
                            viewBox="0 0 16 16"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2.5"
                            className="size-3"
                            aria-hidden="true"
                          >
                            <path d="M3.5 8.5l3 3 6-6" />
                          </svg>
                        ) : null}
                      </span>
                      <span className="truncate">{account.email}</span>
                    </Label>
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              No Google accounts linked.{" "}
              <a
                href="/api/auth/google/link"
                className="text-primary underline"
              >
                Link an account
              </a>{" "}
              to enable wakeup triggers.
            </p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Schedule</CardTitle>
          <CardDescription>
            How often wakeup triggers should run.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <SchedulePicker config={config} onChange={patch} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Trigger Settings</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="grid gap-2 sm:grid-cols-[200px_1fr] sm:items-center">
            <Label htmlFor="prompt">Custom prompt</Label>
            <Input
              id="prompt"
              value={config.customPrompt}
              maxLength={500}
              onChange={(e) => patch({ customPrompt: e.target.value })}
            />
          </div>
          <div className="grid gap-2 sm:grid-cols-[200px_1fr] sm:items-center">
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
              className="sm:max-w-32"
            />
          </div>
          <div className="grid gap-2 sm:grid-cols-[200px_1fr] sm:items-center">
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
              className="sm:max-w-32"
            />
          </div>
          <Separator />
          <div className="flex items-center justify-between gap-4">
            <div className="space-y-0.5">
              <Label htmlFor="wake-on-reset" className="cursor-pointer">
                Wake on quota reset
              </Label>
              <p className="text-xs text-muted-foreground">
                Trigger wakeup automatically when a model's quota resets.
              </p>
            </div>
            <Switch
              id="wake-on-reset"
              checked={config.wakeOnReset}
              onCheckedChange={(v) => patch({ wakeOnReset: v === true })}
            />
          </div>
        </CardContent>
      </Card>

      <div className="flex items-center gap-3">
        <Button onClick={handleSave} disabled={saving}>
          {saving ? <Loader2 className="animate-spin" /> : <Save />}
          Save configuration
        </Button>
        <Button variant="ghost" onClick={handleReset} disabled={saving}>
          Reset to defaults
        </Button>
      </div>
    </div>
  );
}
