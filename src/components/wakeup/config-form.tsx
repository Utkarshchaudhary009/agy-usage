"use client";

import { Clock, Loader2, Save, Zap } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input, NumericInput } from "@/components/ui/input";
import type {
  ScheduleMode,
  WakeupAccountOption,
  WakeupConfig,
} from "@/lib/types/wakeup";
import { cn } from "@/lib/utils";
import { isValidCronExpression, nextTriggerTime } from "@/lib/wakeup/schedule";
import { ModelSelector } from "./model-selector";
import { SchedulePicker } from "./schedule-picker";

interface ConfigFormProps {
  config: WakeupConfig;
  accounts: WakeupAccountOption[];
}

export function ConfigForm({ config, accounts }: ConfigFormProps) {
  const [form, setForm] = useState<WakeupConfig>(config);
  const [isSaving, setIsSaving] = useState(false);

  // The "next trigger" preview is formatted with the locale/timezone of the
  // viewer. That differs between the server (SSR) and the client, so rendering
  // it during hydration would cause a mismatch. Only show it after mount.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  // Re-sync local form state whenever the incoming config changes (e.g. after an
  // external refetch or a successful save returns an updated config).
  useEffect(() => {
    setForm(config);
  }, [config]);

  function update(partial: Partial<WakeupConfig>) {
    setForm((prev) => ({ ...prev, ...partial }));
  }

  const nextTrigger = useMemo(
    () => (form.enabled ? nextTriggerTime(form) : null),
    [form],
  );

  const cronValid =
    form.scheduleMode !== "custom" ||
    isValidCronExpression(form.cronExpression ?? "");

  function toggleAccount(accountId: string, checked: boolean) {
    if (checked) {
      update({
        selectedAccountIds: [...form.selectedAccountIds, accountId],
      });
    } else {
      update({
        selectedAccountIds: form.selectedAccountIds.filter(
          (id) => id !== accountId,
        ),
      });
    }
  }

  async function handleSave() {
    if (form.scheduleMode === "custom" && !cronValid) {
      toast.error("Fix the cron expression before saving.");
      return;
    }

    setIsSaving(true);
    try {
      const res = await fetch("/api/wakeup/config", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const json = (await res.json().catch(() => ({}))) as {
        message?: string;
        error?: string;
        config?: WakeupConfig;
      };

      if (!res.ok) {
        toast.error(
          json.message || json.error || "Could not save wakeup configuration.",
        );
        return;
      }

      if (json.config) setForm(json.config);
      toast.success("Wakeup configuration saved.");
    } catch {
      toast.error("Network error while saving. Please try again.");
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-2">
              <Zap className="size-5 text-primary" />
              <CardTitle>Wakeup Engine</CardTitle>
            </div>
            <Toggle
              checked={form.enabled}
              disabled={isSaving}
              onChange={(checked) => update({ enabled: checked })}
              label="Enable scheduled wakeup"
            />
          </div>
          <CardDescription>
            Periodically send a tiny request to each selected model so it stays
            warm and ready. Minimal token usage.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-6">
          {!form.enabled && (
            <p className="rounded-md bg-muted px-3 py-2 text-sm text-muted-foreground">
              Wakeup is disabled. Toggle it on to schedule automatic triggers.
            </p>
          )}

          <section className="flex flex-col gap-2">
            <h3 className="text-sm font-semibold">Models to wake</h3>
            <ModelSelector
              selectedModels={form.selectedModels}
              onChange={(models) => update({ selectedModels: models })}
              disabled={isSaving}
            />
          </section>

          <section className="flex flex-col gap-2">
            <h3 className="text-sm font-semibold">Accounts</h3>
            <p className="text-xs text-muted-foreground">
              Leave all unchecked to wake every linked account.
            </p>
            {accounts.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No linked Google accounts yet. Add one from the Accounts page.
              </p>
            ) : (
              <div className="grid gap-2 sm:grid-cols-2">
                {accounts.map((account) => {
                  const checked = form.selectedAccountIds.includes(account.id);
                  const usable =
                    account.isActive && account.tokenStatus === "active";
                  return (
                    <label
                      key={account.id}
                      className={cn(
                        "flex items-center gap-3 rounded-lg border p-3 text-sm",
                        checked
                          ? "border-primary bg-primary/5"
                          : "border-input bg-background hover:bg-muted",
                        !usable && "opacity-60",
                        isSaving && "opacity-50",
                      )}
                    >
                      <input
                        type="checkbox"
                        className="size-4 rounded border-input accent-primary"
                        checked={checked}
                        disabled={isSaving || !usable}
                        onChange={(event) =>
                          toggleAccount(account.id, event.target.checked)
                        }
                      />
                      <span className="flex flex-col">
                        <span className="truncate">{account.email}</span>
                        {account.displayName && (
                          <span className="truncate text-xs text-muted-foreground">
                            {account.displayName}
                          </span>
                        )}
                      </span>
                      {!usable && (
                        <span className="ml-auto rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
                          {account.tokenStatus === "revoked"
                            ? "Revoked"
                            : account.tokenStatus === "expired"
                              ? "Expired"
                              : "Inactive"}
                        </span>
                      )}
                    </label>
                  );
                })}
              </div>
            )}
          </section>

          <section className="flex flex-col gap-3">
            <h3 className="text-sm font-semibold">Schedule</h3>
            <SchedulePicker
              scheduleMode={form.scheduleMode}
              intervalHours={form.intervalHours}
              dailyTimes={form.dailyTimes}
              cronExpression={form.cronExpression ?? ""}
              onModeChange={(mode: ScheduleMode) =>
                update({ scheduleMode: mode })
              }
              onIntervalChange={(hours) => update({ intervalHours: hours })}
              onDailyTimesChange={(times) => update({ dailyTimes: times })}
              onCronChange={(expr) => update({ cronExpression: expr })}
              disabled={isSaving}
            />
            {form.scheduleMode === "custom" && !cronValid && (
              <p className="text-xs text-destructive">
                Invalid cron expression.
              </p>
            )}
            {mounted && nextTrigger && (
              <p className="flex items-center gap-2 text-sm text-muted-foreground">
                <Clock className="size-4" />
                Next trigger:{" "}
                <span className="font-medium text-foreground">
                  {formatNextRun(nextTrigger)}
                </span>
              </p>
            )}
          </section>

          <section className="flex flex-col gap-3">
            <h3 className="text-sm font-semibold">Trigger options</h3>
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="flex flex-col gap-1" htmlFor="wakeup-prompt">
                <span className="text-xs font-medium text-muted-foreground">
                  Prompt
                </span>
                <Input
                  id="wakeup-prompt"
                  type="text"
                  value={form.customPrompt}
                  disabled={isSaving}
                  maxLength={2000}
                  onChange={(event) =>
                    update({ customPrompt: event.target.value })
                  }
                />
              </label>
              <label
                className="flex flex-col gap-1"
                htmlFor="wakeup-max-output-tokens"
              >
                <span className="text-xs font-medium text-muted-foreground">
                  Max output tokens
                </span>
                <NumericInput
                  id="wakeup-max-output-tokens"
                  min={1}
                  max={8192}
                  value={form.maxOutputTokens}
                  disabled={isSaving}
                  onValueChange={(value) => update({ maxOutputTokens: value })}
                />
              </label>
              <label
                className="flex flex-col gap-1"
                htmlFor="wakeup-cooldown-minutes"
              >
                <span className="text-xs font-medium text-muted-foreground">
                  Cooldown (minutes)
                </span>
                <NumericInput
                  id="wakeup-cooldown-minutes"
                  min={0}
                  max={1440}
                  value={form.cooldownMinutes}
                  disabled={isSaving}
                  onValueChange={(value) => update({ cooldownMinutes: value })}
                />
              </label>
            </div>
            <label className="flex items-center gap-3 text-sm">
              <input
                type="checkbox"
                className="size-4 rounded border-input accent-primary"
                checked={form.wakeOnReset}
                disabled={isSaving}
                onChange={(event) =>
                  update({ wakeOnReset: event.target.checked })
                }
              />
              <span>
                Auto-trigger on quota reset (when a model refills to 100%)
              </span>
            </label>
          </section>

          <div className="flex justify-end">
            <Button type="button" onClick={handleSave} disabled={isSaving}>
              {isSaving ? <Loader2 className="animate-spin" /> : <Save />}
              {isSaving ? "Saving..." : "Save configuration"}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function Toggle({
  checked,
  onChange,
  disabled,
  label,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
  label: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        "relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors",
        checked ? "bg-primary" : "bg-muted-foreground/30",
        disabled && "opacity-50",
      )}
    >
      <span
        className={cn(
          "inline-block size-5 transform rounded-full bg-white shadow transition-transform",
          checked ? "translate-x-5" : "translate-x-0.5",
        )}
      />
    </button>
  );
}

const NEXT_RUN_FORMATTER = new Intl.DateTimeFormat(undefined, {
  dateStyle: "medium",
  timeStyle: "short",
});

function formatNextRun(date: Date): string {
  return NEXT_RUN_FORMATTER.format(date);
}
