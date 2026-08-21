"use client";

import { Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input, NumericInput } from "@/components/ui/input";
import type { ScheduleMode } from "@/lib/types/wakeup";
import { cn } from "@/lib/utils";

const MODES: { value: ScheduleMode; label: string; hint: string }[] = [
  { value: "interval", label: "Interval", hint: "Every N hours" },
  { value: "daily", label: "Daily", hint: "Fixed times" },
  { value: "custom", label: "Custom", hint: "Cron expression" },
];

interface SchedulePickerProps {
  scheduleMode: ScheduleMode;
  intervalHours: number;
  dailyTimes: string[];
  cronExpression: string;
  onModeChange: (mode: ScheduleMode) => void;
  onIntervalChange: (hours: number) => void;
  onDailyTimesChange: (times: string[]) => void;
  onCronChange: (expr: string) => void;
  disabled?: boolean;
}

export function SchedulePicker({
  scheduleMode,
  intervalHours,
  dailyTimes,
  cronExpression,
  onModeChange,
  onIntervalChange,
  onDailyTimesChange,
  onCronChange,
  disabled,
}: SchedulePickerProps) {
  // Entries are derived from the parent-owned `dailyTimes` prop (the single
  // source of truth) rather than kept in internal state. This keeps the picker
  // in sync when the parent resets the form (e.g. after a successful save) and
  // guarantees deterministic, index-based keys so the server render and client
  // hydration agree — Math.random() ids would cause a hydration mismatch.
  const entries = dailyTimes.map((time, index) => ({
    id: `time-${index}`,
    time,
  }));

  function addDailyTime() {
    onDailyTimesChange([...dailyTimes, "12:00"]);
  }

  function removeDailyTime(id: string) {
    const index = entries.findIndex((entry) => entry.id === id);
    if (index === -1) return;
    onDailyTimesChange(dailyTimes.filter((_, i) => i !== index));
  }

  function updateDailyTime(id: string, value: string) {
    const index = entries.findIndex((entry) => entry.id === id);
    if (index === -1) return;
    onDailyTimesChange(dailyTimes.map((t, i) => (i === index ? value : t)));
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-3 gap-2">
        {MODES.map((mode) => (
          <button
            key={mode.value}
            type="button"
            disabled={disabled}
            onClick={() => onModeChange(mode.value)}
            aria-pressed={scheduleMode === mode.value}
            className={cn(
              "flex flex-col items-start rounded-lg border p-3 text-left transition-colors",
              scheduleMode === mode.value
                ? "border-primary bg-primary/5"
                : "border-input bg-background hover:bg-muted",
              disabled && "opacity-50",
            )}
          >
            <span className="text-sm font-medium">{mode.label}</span>
            <span className="text-xs text-muted-foreground">{mode.hint}</span>
          </button>
        ))}
      </div>

      {scheduleMode === "interval" && (
        <div className="flex items-center gap-2">
          <label
            htmlFor="interval-hours"
            className="text-sm text-muted-foreground"
          >
            Every
          </label>
          <NumericInput
            id="interval-hours"
            min={1}
            max={168}
            className="w-24"
            value={intervalHours}
            disabled={disabled}
            onValueChange={(hours) => {
              if (Number.isInteger(hours) && hours >= 1 && hours <= 168) {
                onIntervalChange(hours);
              }
            }}
          />
          <span className="text-sm text-muted-foreground">hours</span>
        </div>
      )}

      {scheduleMode === "daily" && (
        <div className="flex flex-col gap-2">
          {entries.map((entry, index) => (
            <div key={entry.id} className="flex items-center gap-2">
              <Input
                type="time"
                className="w-40"
                value={entry.time}
                disabled={disabled}
                aria-label={`Wakeup time ${index + 1}`}
                onChange={(event) =>
                  updateDailyTime(entry.id, event.target.value)
                }
              />
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                disabled={disabled || entries.length <= 1}
                onClick={() => removeDailyTime(entry.id)}
                aria-label={`Remove time ${entry.time}`}
              >
                <X />
              </Button>
            </div>
          ))}
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={disabled}
            onClick={addDailyTime}
          >
            <Plus />
            Add time
          </Button>
        </div>
      )}

      {scheduleMode === "custom" && (
        <div className="flex flex-col gap-2">
          <Input
            type="text"
            placeholder="0 */6 * * *"
            value={cronExpression}
            disabled={disabled}
            aria-label="Cron expression"
            onChange={(event) => onCronChange(event.target.value)}
          />
          <p className="text-xs text-muted-foreground">
            Standard 5-field cron (minute hour day-of-month month day-of-week).
          </p>
        </div>
      )}
    </div>
  );
}
