"use client";

import { Plus, X } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import type { ScheduleMode } from "@/lib/types/wakeup";
import { cn } from "@/lib/utils";

interface DailyTimeEntry {
  id: string;
  time: string;
}

function makeId(): string {
  return Math.random().toString(36).slice(2);
}

const inputClass =
  "flex h-9 w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm ring-offset-background placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring disabled:cursor-not-allowed disabled:opacity-50";

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
  // Daily times are tracked with stable ids so list edits don't disturb input
  // focus or component state. The parent still owns the canonical string[].
  const [entries, setEntries] = useState<DailyTimeEntry[]>(() =>
    dailyTimes.map((time) => ({ id: makeId(), time })),
  );

  function syncEntries(next: DailyTimeEntry[]) {
    setEntries(next);
    onDailyTimesChange(next.map((entry) => entry.time));
  }

  function addDailyTime() {
    syncEntries([...entries, { id: makeId(), time: "12:00" }]);
  }

  function removeDailyTime(id: string) {
    syncEntries(entries.filter((entry) => entry.id !== id));
  }

  function updateDailyTime(id: string, value: string) {
    syncEntries(
      entries.map((entry) =>
        entry.id === id ? { ...entry, time: value } : entry,
      ),
    );
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
          <input
            id="interval-hours"
            type="number"
            min={1}
            max={168}
            className={cn(inputClass, "w-24")}
            value={intervalHours}
            disabled={disabled}
            onChange={(event) => onIntervalChange(Number(event.target.value))}
          />
          <span className="text-sm text-muted-foreground">hours</span>
        </div>
      )}

      {scheduleMode === "daily" && (
        <div className="flex flex-col gap-2">
          {entries.map((entry) => (
            <div key={entry.id} className="flex items-center gap-2">
              <input
                type="time"
                className={cn(inputClass, "w-40")}
                value={entry.time}
                disabled={disabled}
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
          <input
            type="text"
            inputMode="text"
            placeholder="0 */6 * * *"
            className={inputClass}
            value={cronExpression}
            disabled={disabled}
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
