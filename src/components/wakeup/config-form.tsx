"use client";

import { useRouter } from "next/navigation";
import { useCallback, useMemo, useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { ModelSelector } from "@/components/wakeup/model-selector";
import { SchedulePicker } from "@/components/wakeup/schedule-picker";
import type { WakeupAccountOption, WakeupConfig } from "@/lib/types/wakeup";
import { cn } from "@/lib/utils";

interface ConfigFormProps {
  initialConfig: WakeupConfig;
  accounts: WakeupAccountOption[];
  accountsUnavailable: boolean;
}

export function ConfigForm({
  initialConfig,
  accounts,
  accountsUnavailable,
}: ConfigFormProps) {
  const router = useRouter();
  const [baseline, setBaseline] = useState<WakeupConfig>(initialConfig);
  const [draft, setDraft] = useState<WakeupConfig>(initialConfig);
  const [isSaving, setIsSaving] = useState(false);

  const isDirty = useMemo(
    () => JSON.stringify(draft) !== JSON.stringify(baseline),
    [draft, baseline],
  );

  const patch = useCallback((changes: Partial<WakeupConfig>) => {
    setDraft((prev) => ({ ...prev, ...changes }));
  }, []);

  const toggleModel = useCallback((modelId: string) => {
    setDraft((prev) => ({
      ...prev,
      selectedModels: prev.selectedModels.includes(modelId)
        ? prev.selectedModels.filter((id) => id !== modelId)
        : [...prev.selectedModels, modelId],
    }));
  }, []);

  const toggleAccount = useCallback((accountId: string) => {
    setDraft((prev) => ({
      ...prev,
      selectedAccountIds: prev.selectedAccountIds.includes(accountId)
        ? prev.selectedAccountIds.filter((id) => id !== accountId)
        : [...prev.selectedAccountIds, accountId],
    }));
  }, []);

  const save = async () => {
    setIsSaving(true);
    try {
      const res = await fetch("/api/wakeup/config", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          enabled: draft.enabled,
          selectedModels: draft.selectedModels,
          selectedAccountIds: draft.selectedAccountIds,
          scheduleMode: draft.scheduleMode,
          intervalHours: draft.intervalHours,
          dailyTimes: draft.dailyTimes,
          cronExpression: draft.cronExpression,
          customPrompt: draft.customPrompt,
          maxOutputTokens: draft.maxOutputTokens,
          cooldownMinutes: draft.cooldownMinutes,
          wakeOnReset: draft.wakeOnReset,
        }),
        // Bound the request so a stalled server cannot hang the UI.
        signal: AbortSignal.timeout(15_000),
      });
      const json = (await res.json().catch(() => ({}))) as {
        config?: WakeupConfig;
        message?: string;
        error?: string;
      };

      if (!res.ok || !json.config) {
        toast.error(json.message || json.error || "Failed to save schedule");
        return;
      }

      const saved = json.config;
      setBaseline(saved);
      setDraft(saved);
      toast.success("Wakeup schedule saved");
      router.refresh();
    } catch (err) {
      // DOMException (AbortError/TimeoutError) is not guaranteed to satisfy
      // `instanceof Error` in every browser, so inspect the name directly.
      const errName =
        typeof err === "object" && err !== null && "name" in err
          ? String((err as { name: unknown }).name)
          : undefined;

      if (errName === "AbortError" || errName === "TimeoutError") {
        toast.info("Save is taking longer than expected. Try again shortly.");
      } else {
        toast.error(
          err instanceof Error ? err.message : "Failed to save schedule",
        );
      }
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-3">
            <Switch
              checked={draft.enabled}
              onChange={(enabled) => patch({ enabled })}
              label="Enable wakeup triggers"
            />
            <span>Wakeup</span>
            <Badge variant={draft.enabled ? "default" : "outline"}>
              {draft.enabled ? "On" : "Off"}
            </Badge>
          </CardTitle>
          <CardDescription>
            Periodically send a minimal request to keep your models warm and
            reset idle quota windows.
          </CardDescription>
        </CardHeader>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Models</CardTitle>
          <CardDescription>
            Choose which models to keep warm on every trigger.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ModelSelector
            selectedIds={draft.selectedModels}
            onToggle={toggleModel}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Accounts</CardTitle>
          <CardDescription>
            Triggers run for each selected account. With none selected, all
            linked accounts are used.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {accountsUnavailable ? (
            <p className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">
              Couldn't load your linked accounts. Refresh the page to retry.
            </p>
          ) : accounts.length === 0 ? (
            <p className="rounded-lg bg-muted/50 px-3 py-2 text-sm text-muted-foreground">
              No Google accounts linked yet.{" "}
              <a
                href="/accounts"
                className="text-primary underline-offset-4 hover:underline"
              >
                Link one first
              </a>
              .
            </p>
          ) : (
            <div className="grid gap-2 sm:grid-cols-2">
              {accounts.map((account) => {
                const checked = draft.selectedAccountIds.includes(account.id);
                return (
                  <label
                    key={account.id}
                    className={cn(
                      "flex cursor-pointer items-center gap-3 rounded-lg border p-3 transition-colors",
                      checked
                        ? "border-primary/40 bg-primary/5"
                        : "border-border hover:bg-muted/50",
                    )}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggleAccount(account.id)}
                      className="size-4 accent-[var(--primary)]"
                    />
                    <span className="min-w-0 flex-1 truncate text-sm font-medium">
                      {account.email}
                    </span>
                    <TokenBadge status={account.tokenStatus} />
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
          <CardDescription>When should wakeup triggers fire?</CardDescription>
        </CardHeader>
        <CardContent>
          {/* lastTriggerAt stays null until Phase 15 wires trigger history in;
              the preview then anchors interval schedules on the last run. */}
          <SchedulePicker draft={draft} onChange={patch} lastTriggerAt={null} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Advanced</CardTitle>
          <CardDescription>
            Fine-tune the trigger payload and pacing.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <label className="block space-y-1.5 sm:col-span-2">
            <span className="text-sm font-medium">Prompt</span>
            <input
              type="text"
              value={draft.customPrompt}
              maxLength={500}
              onChange={(event) => patch({ customPrompt: event.target.value })}
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
            />
            <span className="block text-xs text-muted-foreground">
              Sent with each trigger; kept tiny on purpose.
            </span>
          </label>

          <NumberField
            label="Cooldown (minutes)"
            value={draft.cooldownMinutes}
            min={0}
            max={10080}
            onCommit={(cooldownMinutes) => patch({ cooldownMinutes })}
            hint="Minimum gap between trigger runs."
          />
          <NumberField
            label="Max output tokens"
            value={draft.maxOutputTokens}
            min={1}
            max={8192}
            onCommit={(maxOutputTokens) => patch({ maxOutputTokens })}
            hint="Lower is cheaper; the connection aborts after the first chunk."
          />

          <div className="flex items-center gap-3 sm:col-span-2">
            <Switch
              checked={draft.wakeOnReset}
              onChange={(wakeOnReset) => patch({ wakeOnReset })}
              label="Wake when quota resets"
            />
            <span className="text-sm">
              Trigger as soon as an exhausted quota resets
            </span>
          </div>
        </CardContent>
      </Card>

      <div className="flex items-center justify-end gap-3">
        {!isDirty && (
          <span className="text-xs text-muted-foreground">No changes</span>
        )}
        <Button onClick={save} disabled={!isDirty || isSaving}>
          {isSaving ? "Saving..." : "Save changes"}
        </Button>
      </div>
    </div>
  );
}

interface SwitchProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
}

function Switch({ checked, onChange, label }: SwitchProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={cn(
        "relative inline-flex h-5 w-9 shrink-0 items-center rounded-full outline-none transition-colors focus-visible:ring-3 focus-visible:ring-ring/50",
        checked ? "bg-primary" : "bg-muted ring-1 ring-foreground/20",
      )}
    >
      <span
        className={cn(
          "inline-block size-4 rounded-full bg-background shadow transition-transform",
          checked ? "translate-x-[18px]" : "translate-x-0.5",
        )}
      />
    </button>
  );
}

interface NumberFieldProps {
  label: string;
  value: number;
  min: number;
  max: number;
  onCommit: (value: number) => void;
  hint: string;
}

function NumberField({
  label,
  value,
  min,
  max,
  onCommit,
  hint,
}: NumberFieldProps) {
  return (
    <label className="block space-y-1.5">
      <span className="text-sm font-medium">{label}</span>
      <input
        type="number"
        value={value}
        min={min}
        max={max}
        onChange={(event) => {
          const parsed = Number.parseInt(event.target.value, 10);
          if (!Number.isNaN(parsed)) {
            onCommit(Math.min(max, Math.max(min, parsed)));
          }
        }}
        className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
      />
      <span className="block text-xs text-muted-foreground">{hint}</span>
    </label>
  );
}

function TokenBadge({
  status,
}: {
  status: WakeupAccountOption["tokenStatus"];
}) {
  if (status === "active") return null;
  return (
    <Badge variant={status === "expired" ? "secondary" : "destructive"}>
      {status === "expired" ? "Re-auth" : "Revoked"}
    </Badge>
  );
}
