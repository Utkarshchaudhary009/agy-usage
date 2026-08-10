"use client";

import { Loader2, Save } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import { ModelSelector } from "@/components/wakeup/model-selector";
import { SchedulePicker } from "@/components/wakeup/schedule-picker";
import type { WakeupAccount, WakeupConfig } from "@/lib/types/wakeup";
import { WAKEUP_LIMITS } from "@/lib/types/wakeup";
import { cn } from "@/lib/utils";
import {
  describeSchedule,
  nextTriggerPreview,
  validateCron,
} from "@/lib/wakeup/schedule";

function formatNext(date: Date | null): string {
  if (!date) return "—";
  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Extracts `{ fields: { field: message } }` from an untyped error payload. */
function readFieldErrors(payload: unknown): Record<string, string> | null {
  if (!isRecord(payload) || !isRecord(payload.fields)) return null;
  const fields: Record<string, string> = {};
  for (const [key, value] of Object.entries(payload.fields)) {
    if (typeof value === "string") fields[key] = value;
  }
  return Object.keys(fields).length > 0 ? fields : null;
}

/** Extracts `{ message }` from an untyped error payload. */
function readMessage(payload: unknown): string | null {
  if (!isRecord(payload)) return null;
  return typeof payload.message === "string" ? payload.message : null;
}

export function WakeupConfigForm({
  initialConfig,
  accounts,
  accountsLoadFailed = false,
}: {
  initialConfig: WakeupConfig;
  accounts: WakeupAccount[];
  /** True when the linked-account query failed; the rest stays editable. */
  accountsLoadFailed?: boolean;
}) {
  const [enabled, setEnabled] = useState(initialConfig.enabled);
  const [selectedModels, setSelectedModels] = useState(
    initialConfig.selectedModels,
  );
  const [selectedAccountIds, setSelectedAccountIds] = useState(
    initialConfig.selectedAccountIds,
  );
  const [scheduleMode, setScheduleMode] = useState(initialConfig.scheduleMode);
  const [intervalHours, setIntervalHours] = useState(
    initialConfig.intervalHours,
  );
  const [dailyTimes, setDailyTimes] = useState(initialConfig.dailyTimes);
  const [cronExpression, setCronExpression] = useState(
    initialConfig.cronExpression,
  );
  const [customPrompt, setCustomPrompt] = useState(initialConfig.customPrompt);
  const [maxOutputTokens, setMaxOutputTokens] = useState(
    String(initialConfig.maxOutputTokens),
  );
  const [cooldownMinutes, setCooldownMinutes] = useState(
    String(initialConfig.cooldownMinutes),
  );
  const [wakeOnReset, setWakeOnReset] = useState(initialConfig.wakeOnReset);

  const [saving, setSaving] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  // Time-relative previews depend on the current clock and locale, which differ
  // between the server (SSR) and the client (hydration) and would cause a
  // hydration mismatch. Only compute them after the component has mounted.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const cronError = useMemo(() => {
    if (scheduleMode !== "custom" || !cronExpression) return undefined;
    const result = validateCron(cronExpression);
    return result.valid ? undefined : result.error;
  }, [scheduleMode, cronExpression]);

  const nextTrigger = useMemo(() => {
    if (!mounted) return null;
    return nextTriggerPreview({
      scheduleMode,
      intervalHours,
      dailyTimes,
      cronExpression,
    });
  }, [mounted, scheduleMode, intervalHours, dailyTimes, cronExpression]);

  // Empty means "every linked account", which reads very differently from the
  // state where every checkbox happens to be ticked, so the two are described
  // separately.
  const noAccountsSelected = selectedAccountIds.length === 0;
  const everyAccountSelected =
    accounts.length > 0 && selectedAccountIds.length === accounts.length;

  function toggleAccount(id: string, checked: boolean) {
    if (checked) {
      setSelectedAccountIds([...selectedAccountIds, id]);
    } else {
      setSelectedAccountIds(selectedAccountIds.filter((a) => a !== id));
    }
  }

  async function handleSave() {
    setSaving(true);
    setFieldErrors({});

    const payload = {
      enabled,
      selectedModels,
      selectedAccountIds,
      scheduleMode,
      intervalHours,
      dailyTimes,
      cronExpression,
      customPrompt,
      maxOutputTokens: Number(maxOutputTokens),
      cooldownMinutes: Number(cooldownMinutes),
      wakeOnReset,
    };

    try {
      const res = await fetch("/api/wakeup/config", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      // The body is untrusted: a proxy or an unexpected failure can return
      // HTML or nothing at all, and a parse error here would otherwise be
      // reported as a network failure.
      const json = await res.json().catch(() => null);

      if (!res.ok) {
        const fields = readFieldErrors(json);
        if (res.status === 400 && fields) {
          setFieldErrors(fields);
          toast.error("Please fix the highlighted fields.");
        } else {
          toast.error(readMessage(json) ?? "Failed to save settings.");
        }
        return;
      }

      toast.success("Wakeup settings saved.");
    } catch {
      toast.error("Network error while saving settings.");
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
              <CardTitle>Wakeup automation</CardTitle>
              <p className="text-sm text-muted-foreground">
                Keep your models warm by triggering short requests on a
                schedule.
              </p>
            </div>
            <Switch
              checked={enabled}
              onCheckedChange={setEnabled}
              aria-label="Enable wakeup automation"
            />
          </div>
        </CardHeader>
        <CardContent>
          {/* A real `<fieldset disabled>` rather than pointer-events/aria-hidden
              styling: it removes the controls from the tab order and blocks
              edits for keyboard users too. The master switch (in the header)
              and the Save row below stay outside it, so a user can always
              persist `enabled: false`. */}
          <fieldset
            disabled={!enabled}
            className={cn("min-w-0", !enabled && "opacity-50")}
          >
            <div className="grid gap-6 lg:grid-cols-2">
              <div className="space-y-4">
                <ModelSelector
                  value={selectedModels}
                  onChange={setSelectedModels}
                  error={fieldErrors.selectedModels}
                />

                <div className="space-y-2">
                  <Label>Accounts</Label>
                  {accountsLoadFailed ? (
                    <p className="text-sm text-destructive">
                      Could not load your linked accounts. Reload the page to
                      try again — your other settings can still be saved.
                    </p>
                  ) : accounts.length === 0 ? (
                    <p className="text-sm text-muted-foreground">
                      No Google accounts linked yet. Link an account from the
                      Accounts page to enable wakeups.
                    </p>
                  ) : (
                    <div className="grid gap-2">
                      {accounts.map((acc) => (
                        <label
                          key={acc.id}
                          htmlFor={`wakeup-account-${acc.id}`}
                          className="flex cursor-pointer items-center gap-3 rounded-lg border border-border p-3 hover:bg-muted/50"
                        >
                          <Checkbox
                            id={`wakeup-account-${acc.id}`}
                            checked={selectedAccountIds.includes(acc.id)}
                            onCheckedChange={(c) =>
                              toggleAccount(acc.id, c === true)
                            }
                          />
                          <span className="text-sm">
                            {acc.displayName ?? acc.email}
                          </span>
                        </label>
                      ))}
                      <p className="text-xs text-muted-foreground">
                        {noAccountsSelected
                          ? "No accounts selected — all linked accounts will be woken."
                          : everyAccountSelected
                            ? "All linked accounts will be woken."
                            : `Waking ${selectedAccountIds.length} of ${accounts.length} accounts.`}
                      </p>
                    </div>
                  )}
                </div>
              </div>

              <div className="space-y-4">
                <SchedulePicker
                  mode={scheduleMode}
                  intervalHours={intervalHours}
                  dailyTimes={dailyTimes}
                  cronExpression={cronExpression}
                  onModeChange={setScheduleMode}
                  onIntervalChange={setIntervalHours}
                  onDailyTimesChange={setDailyTimes}
                  onCronChange={setCronExpression}
                  cronError={cronError ?? fieldErrors.cronExpression}
                  disabled={!enabled}
                />

                <Separator />

                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="prompt">Wake prompt</Label>
                    <Input
                      id="prompt"
                      value={customPrompt}
                      onChange={(e) => setCustomPrompt(e.target.value)}
                      aria-invalid={fieldErrors.customPrompt ? true : undefined}
                    />
                    {fieldErrors.customPrompt ? (
                      <p className="text-xs text-destructive">
                        {fieldErrors.customPrompt}
                      </p>
                    ) : null}
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="tokens">Max output tokens</Label>
                    <Input
                      id="tokens"
                      type="number"
                      min={WAKEUP_LIMITS.maxOutputTokens.min}
                      max={WAKEUP_LIMITS.maxOutputTokens.max}
                      value={maxOutputTokens}
                      onChange={(e) => setMaxOutputTokens(e.target.value)}
                      aria-invalid={
                        fieldErrors.maxOutputTokens ? true : undefined
                      }
                    />
                    {fieldErrors.maxOutputTokens ? (
                      <p className="text-xs text-destructive">
                        {fieldErrors.maxOutputTokens}
                      </p>
                    ) : null}
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="cooldown">Cooldown (minutes)</Label>
                    <Input
                      id="cooldown"
                      type="number"
                      min={WAKEUP_LIMITS.cooldownMinutes.min}
                      max={WAKEUP_LIMITS.cooldownMinutes.max}
                      value={cooldownMinutes}
                      onChange={(e) => setCooldownMinutes(e.target.value)}
                      aria-invalid={
                        fieldErrors.cooldownMinutes ? true : undefined
                      }
                    />
                    {fieldErrors.cooldownMinutes ? (
                      <p className="text-xs text-destructive">
                        {fieldErrors.cooldownMinutes}
                      </p>
                    ) : null}
                  </div>
                </div>

                <label
                  htmlFor="wake-on-reset"
                  className="flex items-center gap-3 rounded-lg border border-border p-3"
                >
                  <Switch
                    id="wake-on-reset"
                    checked={wakeOnReset}
                    onCheckedChange={setWakeOnReset}
                  />
                  <div className="flex flex-col">
                    <span className="text-sm font-medium">
                      Wake on quota reset
                    </span>
                    <span className="text-xs text-muted-foreground">
                      Trigger automatically when a model refills.
                    </span>
                  </div>
                </label>
              </div>
            </div>
          </fieldset>

          <Separator className="my-6" />

          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="text-sm text-muted-foreground">
              <p>
                {describeSchedule({
                  scheduleMode,
                  intervalHours,
                  dailyTimes,
                  cronExpression,
                })}
              </p>
              <p>
                Next trigger:{" "}
                <span className="font-medium text-foreground">
                  {enabled ? formatNext(nextTrigger) : "disabled"}
                </span>
              </p>
            </div>
            <Button onClick={handleSave} disabled={saving}>
              {saving ? <Loader2 className="animate-spin" /> : <Save />}
              {saving ? "Saving…" : "Save settings"}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
