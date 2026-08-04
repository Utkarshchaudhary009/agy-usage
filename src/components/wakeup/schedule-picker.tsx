"use client";

import { Plus, X } from "lucide-react";
import { useCallback, useId, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import {
  type ScheduleMode,
  WAKEUP_LIMITS,
  type WakeupConfigInput,
} from "@/lib/types/wakeup";
import { cn } from "@/lib/utils";
import { describeCronSchedule, parseCronExpression } from "@/lib/wakeup/cron";

const MODE_OPTIONS: { value: ScheduleMode; label: string; hint: string }[] = [
  { value: "interval", label: "Interval", hint: "Every N hours" },
  { value: "daily", label: "Daily times", hint: "At fixed times each day" },
  { value: "custom", label: "Custom cron", hint: "Full cron expression" },
];

const CRON_EXAMPLES = [
  { expression: "0 */6 * * *", label: "Every 6 hours" },
  { expression: "0 9,15,21 * * *", label: "At 09:00, 15:00 and 21:00" },
  { expression: "30 8 * * 1-5", label: "Weekdays at 08:30" },
];

interface SchedulePickerProps {
  scheduleMode: ScheduleMode;
  intervalHours: number;
  dailyTimes: string[];
  cronExpression: string | null;
  onChange: (patch: Partial<WakeupConfigInput>) => void;
  disabled?: boolean;
  /** Field name that failed submit validation, if any. */
  invalidField?: string;
  /** Id of the form-level alert describing that failure. */
  errorId?: string;
}

export function SchedulePicker({
  scheduleMode,
  intervalHours,
  dailyTimes,
  cronExpression,
  onChange,
  disabled = false,
  invalidField,
  errorId,
}: SchedulePickerProps) {
  const fieldId = useId();
  const cronInputId = `${fieldId}-cron`;
  const cronHelpId = `${fieldId}-cron-help`;
  const intervalLabelId = `${fieldId}-interval-label`;
  const dailyLegendId = `${fieldId}-daily-legend`;

  const cronResult = useMemo(
    () => (cronExpression ? parseCronExpression(cronExpression) : null),
    [cronExpression],
  );

  // Reuses the already parsed schedule instead of parsing the string twice.
  const cronDescription = cronResult?.ok
    ? describeCronSchedule(cronResult.schedule)
    : null;

  const setTime = useCallback(
    (index: number, value: string) => {
      const next = [...dailyTimes];
      next[index] = value;
      onChange({ dailyTimes: next });
    },
    [dailyTimes, onChange],
  );

  const removeTime = useCallback(
    (index: number) => {
      onChange({ dailyTimes: dailyTimes.filter((_, i) => i !== index) });
    },
    [dailyTimes, onChange],
  );

  const addTime = useCallback(() => {
    if (dailyTimes.length >= WAKEUP_LIMITS.dailyTimes.max) return;
    onChange({ dailyTimes: [...dailyTimes, "12:00"] });
  }, [dailyTimes, onChange]);

  const invalidProps = (field: string) =>
    invalidField === field
      ? ({ "aria-invalid": true, "aria-describedby": errorId } as const)
      : {};

  return (
    <div className="flex flex-col gap-6">
      <fieldset className="flex flex-col gap-2 sm:flex-row" disabled={disabled}>
        <legend className="sr-only">Schedule mode</legend>
        {MODE_OPTIONS.map((option) => {
          const isSelected = scheduleMode === option.value;
          return (
            <Button
              key={option.value}
              type="button"
              variant={isSelected ? "default" : "outline"}
              size="lg"
              disabled={disabled}
              aria-pressed={isSelected}
              className="h-auto flex-1 flex-col items-start gap-0.5 py-2"
              onClick={() => onChange({ scheduleMode: option.value })}
            >
              <span className="text-sm font-medium">{option.label}</span>
              <span
                className={cn(
                  "text-xs font-normal",
                  isSelected
                    ? "text-primary-foreground/70"
                    : "text-muted-foreground",
                )}
              >
                {option.hint}
              </span>
            </Button>
          );
        })}
      </fieldset>

      {scheduleMode === "interval" && (
        <div className="flex flex-col gap-3">
          <div className="flex items-baseline justify-between">
            {/* Radix renders the slider as a span, which <label for> cannot
                target, so the thumb is labelled via aria-labelledby instead. */}
            <span id={intervalLabelId} className="text-sm font-medium">
              Trigger frequency
            </span>
            <span className="text-sm font-medium tabular-nums">
              Every {intervalHours} {intervalHours === 1 ? "hour" : "hours"}
            </span>
          </div>
          <Slider
            min={WAKEUP_LIMITS.intervalHours.min}
            max={WAKEUP_LIMITS.intervalHours.max}
            step={1}
            value={[intervalHours]}
            disabled={disabled}
            thumbLabelledBy={intervalLabelId}
            onValueChange={([value]) => onChange({ intervalHours: value })}
          />
          <p className="text-xs text-muted-foreground">
            Runs are evenly spaced {intervalHours}{" "}
            {intervalHours === 1 ? "hour" : "hours"} apart on a fixed UTC
            schedule.
          </p>
        </div>
      )}

      {scheduleMode === "daily" && (
        <fieldset className="flex flex-col gap-3" disabled={disabled}>
          <legend id={dailyLegendId} className="text-sm font-medium">
            Daily trigger times (UTC)
          </legend>
          {dailyTimes.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No times added yet. Add at least one time.
            </p>
          ) : (
            <ul className="flex flex-wrap gap-2">
              {dailyTimes.map((time, index) => (
                // Rows are positional: keying on the value would remount the
                // input on every keystroke and steal focus.
                // biome-ignore lint/suspicious/noArrayIndexKey: rows have no stable identity
                <li key={index} className="flex items-center gap-1">
                  <Input
                    type="time"
                    value={time}
                    disabled={disabled}
                    aria-label={`Trigger time ${index + 1} (UTC)`}
                    className="w-30"
                    onChange={(event) => setTime(index, event.target.value)}
                    {...invalidProps("dailyTimes")}
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    disabled={disabled}
                    aria-label={`Remove trigger time ${time || index + 1}`}
                    onClick={() => removeTime(index)}
                  >
                    <X />
                  </Button>
                </li>
              ))}
            </ul>
          )}
          <div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={
                disabled || dailyTimes.length >= WAKEUP_LIMITS.dailyTimes.max
              }
              onClick={addTime}
            >
              <Plus />
              Add time
            </Button>
          </div>
        </fieldset>
      )}

      {scheduleMode === "custom" && (
        <div className="flex flex-col gap-3">
          <Label htmlFor={cronInputId}>Cron expression (UTC)</Label>
          <Input
            id={cronInputId}
            value={cronExpression ?? ""}
            placeholder="0 */6 * * *"
            spellCheck={false}
            autoComplete="off"
            disabled={disabled}
            aria-invalid={
              invalidField === "cronExpression" ||
              (cronResult ? !cronResult.ok : undefined)
            }
            aria-describedby={
              invalidField === "cronExpression" && errorId
                ? `${cronHelpId} ${errorId}`
                : cronHelpId
            }
            className="font-mono"
            maxLength={WAKEUP_LIMITS.cronExpressionLength.max}
            onChange={(event) =>
              onChange({ cronExpression: event.target.value })
            }
          />
          {/* No aria-live: this is the input's description, so screen readers
              re-read it on focus without announcing every keystroke. */}
          <p
            id={cronHelpId}
            className={cn(
              "text-sm",
              cronResult && !cronResult.ok
                ? "text-destructive"
                : "text-muted-foreground",
            )}
          >
            {!cronExpression
              ? "Format: minute hour day-of-month month day-of-week."
              : cronResult?.ok
                ? cronDescription
                : cronResult?.error}
          </p>
          <div className="flex flex-wrap gap-2">
            {CRON_EXAMPLES.map((example) => (
              <Button
                key={example.expression}
                type="button"
                variant="secondary"
                size="xs"
                disabled={disabled}
                onClick={() => onChange({ cronExpression: example.expression })}
              >
                <span className="font-mono">{example.expression}</span>
                <span className="text-muted-foreground">{example.label}</span>
              </Button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
