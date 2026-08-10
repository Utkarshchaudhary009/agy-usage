"use client";

import { Plus, X } from "lucide-react";
import { useId } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import type { ScheduleMode } from "@/lib/types/wakeup";
import { WAKEUP_LIMITS } from "@/lib/types/wakeup";

interface SchedulePickerProps {
  mode: ScheduleMode;
  intervalHours: number;
  dailyTimes: string[];
  cronExpression: string | null;
  onModeChange: (mode: ScheduleMode) => void;
  onIntervalChange: (hours: number) => void;
  onDailyTimesChange: (times: string[]) => void;
  onCronChange: (expr: string | null) => void;
  cronError?: string;
  /**
   * Forwarded to every control rather than relying on a wrapping
   * `<fieldset disabled>`: Radix slider thumbs are `span[role=slider]` and the
   * select trigger is portalled, so neither is reliably reached by the
   * fieldset's implicit disabling.
   */
  disabled?: boolean;
}

export function SchedulePicker({
  mode,
  intervalHours,
  dailyTimes,
  cronExpression,
  onModeChange,
  onIntervalChange,
  onDailyTimesChange,
  onCronChange,
  cronError,
  disabled = false,
}: SchedulePickerProps) {
  const uid = useId();
  const modeId = `${uid}-schedule-mode`;
  const cronId = `${uid}-cron`;
  const cronErrorId = `${uid}-cron-error`;
  const cronHintId = `${uid}-cron-hint`;

  const atTimeLimit = dailyTimes.length >= WAKEUP_LIMITS.maxDailyTimes;
  // A daily schedule with no times would never fire, so the last row is not
  // removable (the server rejects an empty list in daily mode as well).
  const canRemoveTime = dailyTimes.length > 1;

  function addDailyTime() {
    if (atTimeLimit) return;
    // Appended rather than inserted in sorted order: rows are keyed and edited
    // by index, so re-ordering here would move the value under an existing
    // input and steal focus mid-edit.
    onDailyTimesChange([...dailyTimes, "12:00"]);
  }

  function updateDailyTime(index: number, value: string) {
    onDailyTimesChange(dailyTimes.map((t, i) => (i === index ? value : t)));
  }

  function removeDailyTime(index: number) {
    if (!canRemoveTime) return;
    onDailyTimesChange(dailyTimes.filter((_, i) => i !== index));
  }

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor={modeId}>Schedule mode</Label>
        <Select
          value={mode}
          onValueChange={(v) => onModeChange(v as ScheduleMode)}
          disabled={disabled}
        >
          <SelectTrigger id={modeId} className="w-full sm:w-56">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="interval">Interval (every N hours)</SelectItem>
            <SelectItem value="daily">Daily at fixed times</SelectItem>
            <SelectItem value="custom">Custom cron</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {mode === "interval" ? (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label>Interval</Label>
            <span className="text-sm font-medium tabular-nums">
              {intervalHours} hour{intervalHours === 1 ? "" : "s"}
            </span>
          </div>
          <Slider
            value={[intervalHours]}
            min={WAKEUP_LIMITS.intervalHours.min}
            max={WAKEUP_LIMITS.intervalHours.max}
            step={1}
            disabled={disabled}
            aria-label="Hours between wake triggers"
            onValueChange={(v) =>
              onIntervalChange(v[0] ?? WAKEUP_LIMITS.intervalHours.min)
            }
          />
          <p className="text-xs text-muted-foreground">
            Wake triggers run this often across all selected accounts.
          </p>
        </div>
      ) : null}

      {mode === "daily" ? (
        <div className="space-y-2">
          <Label>Daily trigger times (24h)</Label>
          <div className="flex flex-col gap-2">
            {dailyTimes.map((time, index) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: rows are identified by position (edited and removed by index) and are never re-ordered; a value-based key would remount the input on every keystroke and steal focus.
              <div key={index} className="flex items-center gap-2">
                <Input
                  type="time"
                  value={time}
                  onChange={(e) => updateDailyTime(index, e.target.value)}
                  className="w-40"
                  disabled={disabled}
                  aria-label={`Trigger time ${index + 1}`}
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  onClick={() => removeDailyTime(index)}
                  disabled={disabled || !canRemoveTime}
                  aria-label={`Remove ${time}`}
                >
                  <X />
                </Button>
              </div>
            ))}
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={addDailyTime}
              disabled={disabled || atTimeLimit}
              className="w-fit"
            >
              <Plus />
              Add time
            </Button>
            {atTimeLimit ? (
              <p className="text-xs text-muted-foreground">
                Maximum of {WAKEUP_LIMITS.maxDailyTimes} trigger times reached.
              </p>
            ) : null}
            {!canRemoveTime ? (
              <p className="text-xs text-muted-foreground">
                At least one trigger time is required.
              </p>
            ) : null}
          </div>
        </div>
      ) : null}

      {mode === "custom" ? (
        <div className="space-y-2">
          <Label htmlFor={cronId}>Cron expression</Label>
          <Input
            id={cronId}
            value={cronExpression ?? ""}
            placeholder="0 * * * *"
            // The raw value is kept verbatim: trimming on every keystroke makes
            // it impossible to type the spaces between cron fields. Validation
            // and persistence trim it instead.
            onChange={(e) => onCronChange(e.target.value || null)}
            aria-invalid={cronError ? true : undefined}
            aria-describedby={cronError ? cronErrorId : cronHintId}
          />
          <p id={cronHintId} className="text-xs text-muted-foreground">
            Standard 5-field cron (minute hour day-of-month month day-of-week).
          </p>
          {cronError ? (
            <p id={cronErrorId} className="text-xs text-destructive">
              {cronError}
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
