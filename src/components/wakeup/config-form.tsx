"use client";

import { AlertCircle, Loader2, RotateCcw, Save } from "lucide-react";
import {
  type FormEvent,
  useCallback,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useWakeupConfig } from "@/hooks/use-wakeup-config";
import {
  WAKEUP_LIMITS,
  type WakeupAccountOption,
  type WakeupConfig,
  type WakeupConfigInput,
} from "@/lib/types/wakeup";
import { validateWakeupConfigInput } from "@/lib/wakeup/validation";
import { AccountSelector } from "./account-selector";
import { LocalTime } from "./local-time";
import { ModelSelector } from "./model-selector";
import { NextTriggerPreview } from "./next-trigger-preview";
import { SchedulePicker } from "./schedule-picker";

interface WakeupConfigFormProps {
  initialConfig: WakeupConfig;
  accounts: WakeupAccountOption[];
  accountsLoadFailed?: boolean;
}

interface FormError {
  field: string;
  message: string;
}

function toInput(config: WakeupConfig): WakeupConfigInput {
  const { updatedAt: _updatedAt, ...input } = config;
  return input;
}

/**
 * Structural comparison. Both sides always come from `toInput`, so the key
 * order matches and JSON is a safe (and cheap) deep-equality check here.
 */
function isSameConfig(a: WakeupConfigInput, b: WakeupConfigInput): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

export function WakeupConfigForm({
  initialConfig,
  accounts,
  accountsLoadFailed = false,
}: WakeupConfigFormProps) {
  const fieldId = useId();
  const { isSaving, save } = useWakeupConfig();

  const [config, setConfig] = useState<WakeupConfigInput>(() =>
    toInput(initialConfig),
  );
  const [savedConfig, setSavedConfig] = useState<WakeupConfigInput>(() =>
    toInput(initialConfig),
  );
  const [updatedAt, setUpdatedAt] = useState<string | null>(
    initialConfig.updatedAt,
  );
  const [formError, setFormError] = useState<FormError | null>(null);

  // Numeric inputs keep their own draft text so the field can be cleared or
  // partially typed without the number jumping back to a bound.
  const [tokensDraft, setTokensDraft] = useState<string | null>(null);
  const [cooldownDraft, setCooldownDraft] = useState<string | null>(null);

  const errorRef = useRef<HTMLDivElement>(null);

  const update = useCallback((patch: Partial<WakeupConfigInput>) => {
    setFormError(null);
    setConfig((prev) => ({ ...prev, ...patch }));
  }, []);

  const setSelectedModels = useCallback(
    (selectedModels: string[]) => update({ selectedModels }),
    [update],
  );

  const setSelectedAccountIds = useCallback(
    (selectedAccountIds: string[]) => update({ selectedAccountIds }),
    [update],
  );

  const isDirty = useMemo(
    () => !isSameConfig(config, savedConfig),
    [config, savedConfig],
  );

  const handleReset = useCallback(() => {
    setFormError(null);
    setTokensDraft(null);
    setCooldownDraft(null);
    setConfig(savedConfig);
  }, [savedConfig]);

  const handleSubmit = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();

      // The API re-validates; this only avoids a round-trip and surfaces the
      // same message inline.
      const validated = validateWakeupConfigInput(config);
      if (!validated.ok) {
        setFormError({ field: validated.field, message: validated.message });
        errorRef.current?.focus();
        return;
      }

      const saved = await save(validated.value);
      if (!saved) return;

      setFormError(null);
      setTokensDraft(null);
      setCooldownDraft(null);
      setConfig(toInput(saved));
      setSavedConfig(toInput(saved));
      setUpdatedAt(saved.updatedAt);
    },
    [config, save],
  );

  const errorId = `${fieldId}-error`;
  const invalidField = formError?.field;
  // Wires the inline alert to whichever control the error belongs to.
  const fieldErrorProps = (field: string) =>
    invalidField === field
      ? ({ "aria-invalid": true, "aria-describedby": errorId } as const)
      : {};

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-6" noValidate>
      <Card>
        <CardHeader>
          <CardTitle>Automatic wakeup</CardTitle>
          <CardDescription>
            Periodically send a tiny prompt to each selected model so its quota
            window stays active.
          </CardDescription>
          <CardAction>
            <div className="flex items-center gap-2">
              <span aria-hidden="true" className="text-sm font-medium">
                {config.enabled ? "On" : "Off"}
              </span>
              <Switch
                id={`${fieldId}-enabled`}
                checked={config.enabled}
                disabled={isSaving}
                aria-label="Automatic wakeup"
                onCheckedChange={(enabled) => update({ enabled })}
              />
            </div>
          </CardAction>
        </CardHeader>
        <CardContent>
          <NextTriggerPreview config={config} />
        </CardContent>
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Models</CardTitle>
            <CardDescription>
              Each selected model is triggered separately on every run.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ModelSelector
              selectedModels={config.selectedModels}
              onChange={setSelectedModels}
              disabled={isSaving}
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Accounts</CardTitle>
            <CardDescription>
              Which linked Google accounts to keep awake.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <AccountSelector
              accounts={accounts}
              selectedAccountIds={config.selectedAccountIds}
              onChange={setSelectedAccountIds}
              disabled={isSaving}
              loadFailed={accountsLoadFailed}
            />
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Schedule</CardTitle>
          <CardDescription>
            All times are in UTC so schedules stay stable across timezones.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <SchedulePicker
            scheduleMode={config.scheduleMode}
            intervalHours={config.intervalHours}
            dailyTimes={config.dailyTimes}
            cronExpression={config.cronExpression}
            onChange={update}
            disabled={isSaving}
            invalidField={invalidField}
            errorId={errorId}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Trigger details</CardTitle>
          <CardDescription>
            Keep the prompt and output tiny so wakeups cost almost nothing.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <div className="flex flex-col gap-2 sm:col-span-2">
            <Label htmlFor={`${fieldId}-prompt`}>Prompt</Label>
            <Input
              id={`${fieldId}-prompt`}
              value={config.customPrompt}
              disabled={isSaving}
              maxLength={WAKEUP_LIMITS.customPromptLength.max}
              onChange={(event) => update({ customPrompt: event.target.value })}
              {...fieldErrorProps("customPrompt")}
            />
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor={`${fieldId}-tokens`}>Max output tokens</Label>
            <Input
              id={`${fieldId}-tokens`}
              type="number"
              inputMode="numeric"
              value={tokensDraft ?? String(config.maxOutputTokens)}
              min={WAKEUP_LIMITS.maxOutputTokens.min}
              max={WAKEUP_LIMITS.maxOutputTokens.max}
              disabled={isSaving}
              onChange={(event) => {
                const raw = event.target.value;
                setTokensDraft(raw);
                const parsed = Number.parseInt(raw, 10);
                if (!Number.isNaN(parsed)) update({ maxOutputTokens: parsed });
              }}
              // Drop the draft on blur so the committed value is shown again.
              onBlur={() => setTokensDraft(null)}
              {...fieldErrorProps("maxOutputTokens")}
            />
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor={`${fieldId}-cooldown`}>Cooldown (minutes)</Label>
            <Input
              id={`${fieldId}-cooldown`}
              type="number"
              inputMode="numeric"
              value={cooldownDraft ?? String(config.cooldownMinutes)}
              min={WAKEUP_LIMITS.cooldownMinutes.min}
              max={WAKEUP_LIMITS.cooldownMinutes.max}
              disabled={isSaving}
              onChange={(event) => {
                const raw = event.target.value;
                setCooldownDraft(raw);
                const parsed = Number.parseInt(raw, 10);
                if (!Number.isNaN(parsed)) update({ cooldownMinutes: parsed });
              }}
              onBlur={() => setCooldownDraft(null)}
              {...fieldErrorProps("cooldownMinutes")}
            />
            <p className="text-xs text-muted-foreground">
              Skip a run when the last wakeup was less than this long ago.
            </p>
          </div>

          <div className="flex items-start gap-3 sm:col-span-2">
            <Switch
              id={`${fieldId}-wake-on-reset`}
              checked={config.wakeOnReset}
              disabled={isSaving}
              onCheckedChange={(wakeOnReset) => update({ wakeOnReset })}
            />
            <div className="grid gap-0.5">
              <Label htmlFor={`${fieldId}-wake-on-reset`}>
                Wake on quota reset
              </Label>
              <p className="text-xs text-muted-foreground">
                Also trigger right after a model&apos;s quota window resets.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {formError && (
        <div
          id={errorId}
          ref={errorRef}
          role="alert"
          tabIndex={-1}
          className="flex items-start gap-2 rounded-lg border border-destructive/50 p-4 text-sm text-destructive outline-none focus-visible:ring-3 focus-visible:ring-destructive/20"
        >
          <AlertCircle className="mt-0.5 size-4 shrink-0" />
          <span>{formError.message}</span>
        </div>
      )}

      {!accountsLoadFailed && accounts.length === 0 && config.enabled && (
        <div
          role="alert"
          className="flex items-start gap-2 rounded-lg border border-destructive/50 p-4 text-sm text-destructive"
        >
          <AlertCircle className="mt-0.5 size-4 shrink-0" />
          <span>Link a Google account before enabling automatic wakeup.</span>
        </div>
      )}

      <div className="flex flex-col-reverse items-start gap-3 border-t pt-4 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-xs text-muted-foreground">
          {isDirty ? (
            "You have unsaved changes."
          ) : updatedAt ? (
            <>
              Last saved <LocalTime value={updatedAt} />
            </>
          ) : (
            "Not configured yet."
          )}
        </p>
        <div className="flex gap-2">
          <Button
            type="button"
            variant="ghost"
            disabled={!isDirty || isSaving}
            onClick={handleReset}
          >
            <RotateCcw />
            Reset
          </Button>
          <Button type="submit" disabled={!isDirty || isSaving}>
            {isSaving ? <Loader2 className="animate-spin" /> : <Save />}
            {isSaving ? "Saving…" : "Save changes"}
          </Button>
        </div>
      </div>
    </form>
  );
}
