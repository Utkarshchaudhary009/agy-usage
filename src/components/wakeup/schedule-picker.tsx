"use client";

import { Plus, X } from "lucide-react";
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
}: {
  mode: ScheduleMode;
  intervalHours: number;
  dailyTimes: string[];
  cronExpression: string | null;
  onModeChange: (mode: ScheduleMode) => void;
  onIntervalChange: (hours: number) => void;
  onDailyTimesChange: (times: string[]) => void;
  onCronChange: (expr: string | null) => void;
  cronError?: string;
}) {
  function addDailyTime() {
    const next = [...dailyTimes, "12:00"].sort();
    onDailyTimesChange(next);
  }

  function updateDailyTime(index: number, value: string) {
    const next = dailyTimes.map((t, i) => (i === index ? value : t));
    onDailyTimesChange(next);
  }

  function removeDailyTime(index: number) {
    onDailyTimesChange(dailyTimes.filter((_, i) => i !== index));
  }

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="schedule-mode">Schedule mode</Label>
        <Select
          value={mode}
          onValueChange={(v) => onModeChange(v as ScheduleMode)}
        >
          <SelectTrigger id="schedule-mode" className="w-full sm:w-56">
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
            onValueChange={(v) => onIntervalChange(v[0] ?? 1)}
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
              // biome-ignore lint/suspicious/noArrayIndexKey: rows are identified by position (edited and removed by index) and are fully controlled; a value-based key would remount the input on every keystroke and steal focus.
              <div key={index} className="flex items-center gap-2">
                <Input
                  type="time"
                  value={time}
                  onChange={(e) => updateDailyTime(index, e.target.value)}
                  className="w-40"
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  onClick={() => removeDailyTime(index)}
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
              className="w-fit"
            >
              <Plus />
              Add time
            </Button>
          </div>
        </div>
      ) : null}

      {mode === "custom" ? (
        <div className="space-y-2">
          <Label htmlFor="cron">Cron expression</Label>
          <Input
            id="cron"
            value={cronExpression ?? ""}
            placeholder="0 * * * *"
            onChange={(e) =>
              onCronChange(e.target.value.trim() ? e.target.value.trim() : null)
            }
            aria-invalid={cronError ? true : undefined}
          />
          <p className="text-xs text-muted-foreground">
            Standard 5-field cron (minute hour day-of-month month day-of-week).
          </p>
          {cronError ? (
            <p className="text-xs text-destructive">{cronError}</p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
