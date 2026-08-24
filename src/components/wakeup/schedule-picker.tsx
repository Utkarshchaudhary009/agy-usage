"use client";

import { Plus, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { cn, inputClass } from "@/lib/utils";
import type { ScheduleMode } from "@/lib/wakeup/schedule-evaluator";
import {
  isDailyTime,
  isValidCronExpression,
} from "@/lib/wakeup/schedule-evaluator";

interface SchedulePickerProps {
  mode: ScheduleMode;
  intervalHours: number;
  dailyTimes: string[];
  cronExpression: string;
  onModeChange: (mode: ScheduleMode) => void;
  onIntervalChange: (hours: number) => void;
  onDailyTimesChange: (times: string[]) => void;
  onCronChange: (cron: string) => void;
}

const MODE_LABELS: { value: ScheduleMode; label: string; hint: string }[] = [
  { value: "interval", label: "Interval", hint: "Every N hours" },
  { value: "daily", label: "Daily", hint: "At fixed times" },
  { value: "custom", label: "Custom cron", hint: "Advanced schedule" },
];

const DAILY_TIME_SUGGESTIONS = ["09:00", "12:00", "15:00", "18:00", "21:00"];

export function SchedulePicker({
  mode,
  intervalHours,
  dailyTimes,
  cronExpression,
  onModeChange,
  onIntervalChange,
  onDailyTimesChange,
  onCronChange,
}: SchedulePickerProps) {
  // `dailyTimes` is the source of truth (owned by the parent form). We mirror it
  // into local `timeItems` so each row keeps a stable React key while it is being
  // edited/added/removed, and so an external change (e.g. the config reloaded
  // after save) replaces the rows without fighting the user's in-progress typing.
  const [timeItems, setTimeItems] = useState<{ id: string; value: string }[]>(
    () => dailyTimes.map((t, i) => ({ id: `dt-${i}`, value: t })),
  );
  // Set while we mutate `timeItems` ourselves so the prop-sync effect below skips
  // the rebuild (rebuilding would remount the inputs and drop focus mid-edit).
  const internalChange = useRef(false);
  const nextId = useRef(dailyTimes.length);

  useEffect(() => {
    if (internalChange.current) {
      internalChange.current = false;
      return;
    }
    setTimeItems(dailyTimes.map((t, i) => ({ id: `dt-${i}`, value: t })));
  }, [dailyTimes]);

  const addDailyTime = () => {
    internalChange.current = true;
    const used = new Set(timeItems.map((t) => t.value));
    const candidate = DAILY_TIME_SUGGESTIONS.find((t) => !used.has(t)) ?? null;
    if (candidate === null) {
      // Every suggestion is already present; don't insert a duplicate row and
      // instead leave the existing items untouched.
      internalChange.current = false;
      return;
    }
    const id = `new-${nextId.current++}`;
    const next = [...timeItems, { id, value: candidate }];
    setTimeItems(next);
    onDailyTimesChange(next.map((t) => t.value));
  };

  const updateDailyTime = (id: string, value: string) => {
    internalChange.current = true;
    const next = timeItems.map((t) => (t.id === id ? { ...t, value } : t));
    setTimeItems(next);
    onDailyTimesChange(next.map((t) => t.value));
  };

  const removeDailyTime = (id: string) => {
    internalChange.current = true;
    const next = timeItems.filter((t) => t.id !== id);
    setTimeItems(next);
    onDailyTimesChange(next.map((t) => t.value));
  };

  const cronValid =
    cronExpression.trim().length === 0 || isValidCronExpression(cronExpression);

  const canAddDailyTime = DAILY_TIME_SUGGESTIONS.some(
    (t) => !timeItems.some((item) => item.value === t),
  );

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-3 gap-2">
        {MODE_LABELS.map((m) => (
          <button
            key={m.value}
            type="button"
            onClick={() => onModeChange(m.value)}
            className={cn(
              "flex flex-col items-start rounded-lg border px-3 py-2 text-left text-sm transition-colors",
              mode === m.value
                ? "border-primary bg-primary/5 ring-1 ring-primary/40"
                : "border-border bg-background hover:bg-muted",
            )}
          >
            <span className="font-medium">{m.label}</span>
            <span className="text-xs text-muted-foreground">{m.hint}</span>
          </button>
        ))}
      </div>

      {mode === "interval" && (
        <div className="flex items-center gap-3">
          <label htmlFor="interval-hours" className="text-sm font-medium">
            Every
          </label>
          <input
            id="interval-hours"
            type="number"
            min={1}
            max={24}
            value={intervalHours}
            onChange={(e) =>
              onIntervalChange(Number.parseInt(e.target.value, 10) || 1)
            }
            className={cn(inputClass, "w-24")}
          />
          <span className="text-sm text-muted-foreground">hours</span>
        </div>
      )}

      {mode === "daily" && (
        <div className="flex flex-col gap-2">
          <span className="text-sm font-medium">Trigger times (24h)</span>
          <div className="flex flex-wrap gap-2">
            {timeItems.map((item) => (
              <div key={item.id} className="flex items-center gap-1">
                <input
                  type="time"
                  value={item.value}
                  onChange={(e) => updateDailyTime(item.id, e.target.value)}
                  className={cn(inputClass, "w-32")}
                />
                <button
                  type="button"
                  aria-label={`Remove ${item.value}`}
                  onClick={() => removeDailyTime(item.id)}
                  disabled={timeItems.length <= 1}
                  className="flex size-8 items-center justify-center rounded-md border border-border text-muted-foreground transition-colors hover:bg-muted disabled:opacity-40"
                >
                  <X className="size-4" />
                </button>
              </div>
            ))}
            <button
              type="button"
              onClick={addDailyTime}
              disabled={!canAddDailyTime}
              className="flex items-center gap-1 rounded-md border border-dashed border-border px-3 text-sm text-muted-foreground transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-40"
            >
              <Plus className="size-4" />
              Add time
            </button>
          </div>
          {dailyTimes.some((t) => !isDailyTime(t)) && (
            <p className="text-xs text-destructive">
              All times must be in HH:MM format.
            </p>
          )}
        </div>
      )}

      {mode === "custom" && (
        <div className="flex flex-col gap-2">
          <label htmlFor="cron-expression" className="text-sm font-medium">
            Cron expression
          </label>
          <input
            id="cron-expression"
            type="text"
            placeholder="0 * * * *"
            value={cronExpression}
            onChange={(e) => onCronChange(e.target.value)}
            className={cn(inputClass, !cronValid && "border-destructive")}
          />
          <p className="text-xs text-muted-foreground">
            Standard 5-field cron: minute hour day-of-month month day-of-week.
          </p>
          {!cronValid && (
            <p className="text-xs text-destructive">Invalid cron expression.</p>
          )}
        </div>
      )}
    </div>
  );
}
