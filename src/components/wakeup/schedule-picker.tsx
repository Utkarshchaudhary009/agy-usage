"use client";

import { Plus, X } from "lucide-react";
import { useMemo, useState } from "react";
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
import type { WakeupScheduleMode } from "@/lib/types/wakeup";
import { TIME_RE } from "@/lib/types/wakeup";
import { cn, pluralize } from "@/lib/utils";
import { describeCron, nextCronRun, validateCron } from "@/lib/wakeup/cron";

interface SchedulePickerProps {
  mode: WakeupScheduleMode;
  intervalHours: number;
  dailyTimes: string[];
  cronExpression: string | null;
  onModeChange: (mode: WakeupScheduleMode) => void;
  onIntervalChange: (hours: number) => void;
  onDailyTimesChange: (times: string[]) => void;
  onCronChange: (expr: string) => void;
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
}: SchedulePickerProps) {
  const [newTime, setNewTime] = useState("");

  const cronValidation = useMemo(
    () => (cronExpression ? validateCron(cronExpression) : null),
    [cronExpression],
  );
  const cronPreview = useMemo(() => {
    if (!cronExpression) return null;
    if (!cronValidation?.valid) return cronValidation?.error ?? "Invalid";
    const next = nextCronRun(cronExpression);
    const nextStr = next
      ? next.toLocaleString([], {
          month: "short",
          day: "numeric",
          hour: "2-digit",
          minute: "2-digit",
        })
      : "no match in the next year";
    return `${describeCron(cronExpression)} — next run ${nextStr}`;
  }, [cronExpression, cronValidation]);

  const addTime = () => {
    const t = newTime.trim();
    if (!TIME_RE.test(t) || dailyTimes.includes(t)) {
      setNewTime("");
      return;
    }
    onDailyTimesChange([...dailyTimes, t].sort());
    setNewTime("");
  };

  const removeTime = (t: string) => {
    onDailyTimesChange(dailyTimes.filter((x) => x !== t));
  };

  return (
    <div className="space-y-5">
      <div className="space-y-2">
        <Label htmlFor="schedule-mode">Schedule mode</Label>
        <Select
          value={mode}
          onValueChange={(v) => onModeChange(v as WakeupScheduleMode)}
        >
          <SelectTrigger id="schedule-mode" className="max-w-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="interval">Interval (every N hours)</SelectItem>
            <SelectItem value="daily">Daily times</SelectItem>
            <SelectItem value="custom">Custom cron</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {mode === "interval" && (
        <div className="space-y-3 rounded-lg border border-border p-4">
          <div className="flex items-center justify-between">
            <Label htmlFor="interval-slider">Interval</Label>
            <span className="text-sm font-medium tabular-nums">
              every {intervalHours} {pluralize("hour", intervalHours)}
            </span>
          </div>
          <Slider
            id="interval-slider"
            value={[intervalHours]}
            min={1}
            max={24}
            step={1}
            onValueChange={(v) => onIntervalChange(v[0])}
            aria-label="Interval in hours"
          />
          <div className="flex justify-between text-xs text-muted-foreground">
            <span>1h</span>
            <span>24h</span>
          </div>
        </div>
      )}

      {mode === "daily" && (
        <div className="space-y-3 rounded-lg border border-border p-4">
          <p className="text-sm font-medium">Daily trigger times</p>
          <div className="flex flex-wrap gap-2">
            {dailyTimes.map((t) => (
              <span
                key={t}
                className="inline-flex items-center gap-1 rounded-md bg-muted px-2 py-1 text-sm tabular-nums"
              >
                {t}
                <button
                  type="button"
                  onClick={() => removeTime(t)}
                  className="text-muted-foreground hover:text-destructive"
                  aria-label={`Remove ${t}`}
                >
                  <X className="size-3.5" />
                </button>
              </span>
            ))}
            {dailyTimes.length === 0 && (
              <span className="text-sm text-muted-foreground">
                No times set
              </span>
            )}
          </div>
          <div className="flex gap-2">
            <Input
              type="time"
              value={newTime}
              onChange={(e) => setNewTime(e.target.value)}
              className="max-w-[140px]"
              aria-label="New daily time"
            />
            <Button type="button" variant="outline" onClick={addTime}>
              <Plus />
              Add
            </Button>
          </div>
        </div>
      )}

      {mode === "custom" && (
        <div className="space-y-2 rounded-lg border border-border p-4">
          <Label htmlFor="cron">Cron expression</Label>
          <Input
            id="cron"
            value={cronExpression ?? ""}
            onChange={(e) => onCronChange(e.target.value)}
            placeholder="0 */6 * * *"
            className={cn(
              cronValidation && !cronValidation.valid && "border-destructive",
            )}
            aria-invalid={cronValidation ? !cronValidation.valid : undefined}
          />
          <p
            className={cn(
              "text-xs",
              cronValidation && !cronValidation.valid
                ? "text-destructive"
                : "text-muted-foreground",
            )}
          >
            {cronPreview ??
              "Format: minute hour day-of-month month day-of-week"}
          </p>
        </div>
      )}
    </div>
  );
}
