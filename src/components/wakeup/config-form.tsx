"use client";

import { Loader2Icon, PowerIcon, RefreshCwIcon } from "lucide-react";
import { useRouter } from "next/navigation";
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
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { ModelSelector } from "@/components/wakeup/model-selector";
import {
  SchedulePicker,
  type ScheduleState,
} from "@/components/wakeup/schedule-picker";
import type { WakeupConfig, WakeupConfigInput } from "@/lib/types/wakeup";
import { scheduleNextPreview } from "@/lib/wakeup/cron";

export interface WakeupAccountOption {
  id: string;
  email: string;
  displayName: string | null;
  isActive: boolean;
}

interface ConfigFormProps {
  initialConfig: WakeupConfig;
  accounts: WakeupAccountOption[];
}

function toInput(config: WakeupConfig): WakeupConfigInput {
  return {
    enabled: config.enabled,
    selectedModels: config.selectedModels,
    selectedAccountIds: config.selectedAccountIds,
    scheduleMode: config.scheduleMode,
    intervalHours: config.intervalHours,
    dailyTimes: config.dailyTimes,
    cronExpression: config.cronExpression,
    customPrompt: config.customPrompt,
    maxOutputTokens: config.maxOutputTokens,
    cooldownMinutes: config.cooldownMinutes,
    wakeOnReset: config.wakeOnReset,
  };
}

export function ConfigForm({ initialConfig, accounts }: ConfigFormProps) {
  const router = useRouter();
  const [input, setInput] = useState<WakeupConfigInput>(() =>
    toInput(initialConfig),
  );
  const [saving, setSaving] = useState(false);

  const hasAccounts = accounts.length > 0;

  function update<K extends keyof WakeupConfigInput>(
    key: K,
    value: WakeupConfigInput[K],
  ) {
    setInput((prev) => ({ ...prev, [key]: value }));
  }

  function toggleAccount(id: string, checked: boolean) {
    setInput((prev) => ({
      ...prev,
      selectedAccountIds: checked
        ? [...prev.selectedAccountIds, id]
        : prev.selectedAccountIds.filter((a) => a !== id),
    }));
  }

  const scheduleState: ScheduleState = {
    scheduleMode: input.scheduleMode,
    intervalHours: input.intervalHours,
    dailyTimes: input.dailyTimes,
    cronExpression: input.cronExpression,
  };

  const nextPreview = scheduleNextPreview(input.scheduleMode, {
    intervalHours: input.intervalHours,
    dailyTimes: input.dailyTimes,
    cronExpression: input.cronExpression,
  });

  async function onSave() {
    setSaving(true);
    try {
      const res = await fetch("/api/wakeup/config", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      });
      const data = await res.json();

      if (!res.ok) {
        const firstError = data?.fieldErrors
          ? Object.values(data.fieldErrors)[0]
          : data?.message;
        toast.error(firstError ?? "Could not save configuration.");
        return;
      }

      toast.success("Wakeup configuration saved.");
      router.refresh();
    } catch {
      toast.error("Network error while saving.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between gap-4">
            <div>
              <CardTitle>Wakeup engine</CardTitle>
              <CardDescription>
                Keep your favorite models warm by sending a tiny prompt on a
                schedule.
              </CardDescription>
            </div>
            <div className="flex items-center gap-2">
              <PowerIcon
                className={
                  input.enabled
                    ? "size-4 text-primary"
                    : "size-4 text-muted-foreground"
                }
              />
              <Switch
                checked={input.enabled}
                onCheckedChange={(v) => update("enabled", v === true)}
                aria-label="Enable wakeup"
              />
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div
            className={
              input.enabled
                ? "grid gap-6"
                : "pointer-events-none grid gap-6 select-none opacity-50"
            }
          >
            <section className="flex flex-col gap-2">
              <Label>Models to wake up</Label>
              <ModelSelector
                selected={input.selectedModels}
                onChange={(models) => update("selectedModels", models)}
              />
            </section>

            <section className="flex flex-col gap-2">
              <Label>Target accounts</Label>
              {hasAccounts ? (
                <div className="grid gap-2 sm:grid-cols-2">
                  {accounts.map((acc) => {
                    const checked = input.selectedAccountIds.includes(acc.id);
                    const inputId = `wakeup-account-${acc.id}`;
                    return (
                      <Label
                        key={acc.id}
                        htmlFor={inputId}
                        className="flex cursor-pointer items-center gap-2.5 rounded-lg border border-border bg-background px-3 py-2 text-sm font-normal hover:bg-muted"
                      >
                        <Checkbox
                          id={inputId}
                          checked={checked}
                          onCheckedChange={(v) =>
                            toggleAccount(acc.id, v === true)
                          }
                        />
                        <span className="flex flex-col">
                          <span className="font-normal">{acc.email}</span>
                          {!acc.isActive && (
                            <span className="text-xs text-muted-foreground">
                              Not active
                            </span>
                          )}
                        </span>
                      </Label>
                    );
                  })}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">
                  No Google accounts linked yet.
                </p>
              )}
              <p className="text-xs text-muted-foreground">
                Leave all unchecked to target every linked account.
              </p>
            </section>

            <section className="flex flex-col gap-2">
              <Label>Schedule</Label>
              <SchedulePicker
                value={scheduleState}
                onChange={(next) => {
                  update("scheduleMode", next.scheduleMode);
                  update("intervalHours", next.intervalHours);
                  update("dailyTimes", next.dailyTimes);
                  update("cronExpression", next.cronExpression);
                }}
              />
              <p className="text-xs text-muted-foreground">{nextPreview}</p>
            </section>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="prompt">Wake-up prompt</Label>
                <Input
                  id="prompt"
                  value={input.customPrompt}
                  onChange={(e) => update("customPrompt", e.target.value)}
                  placeholder="hi"
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="max-tokens">Max output tokens</Label>
                <Input
                  id="max-tokens"
                  type="number"
                  min={1}
                  max={8192}
                  value={input.maxOutputTokens}
                  onChange={(e) =>
                    update("maxOutputTokens", Number(e.target.value) || 1)
                  }
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="cooldown">Cooldown (minutes)</Label>
                <Input
                  id="cooldown"
                  type="number"
                  min={0}
                  max={1440}
                  value={input.cooldownMinutes}
                  onChange={(e) =>
                    update("cooldownMinutes", Number(e.target.value) || 0)
                  }
                />
              </div>
              <div className="flex items-end gap-3 pb-1">
                <Switch
                  checked={input.wakeOnReset}
                  onCheckedChange={(v) => update("wakeOnReset", v === true)}
                  id="wake-on-reset"
                />
                <Label
                  htmlFor="wake-on-reset"
                  className="cursor-pointer font-normal"
                >
                  Wake on quota reset
                </Label>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="flex items-center justify-end gap-3">
        <Button
          variant="outline"
          onClick={() => router.refresh()}
          disabled={saving}
        >
          <RefreshCwIcon />
          Reset
        </Button>
        <Button onClick={onSave} disabled={saving || !hasAccounts}>
          {saving && <Loader2Icon className="animate-spin" />}
          Save configuration
        </Button>
      </div>
    </div>
  );
}
