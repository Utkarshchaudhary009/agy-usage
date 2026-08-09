"use client";

import { Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import type { ScheduleMode } from "@/lib/types/wakeup";
import { cn } from "@/lib/utils";
import { isValidCron } from "@/lib/wakeup/cron";

export interface ScheduleValue {
  scheduleMode: ScheduleMode;
  intervalHours: number;
  dailyTimes: string[];
  cronExpression: string | null;
}

interface SchedulePickerProps {
  value: ScheduleValue;
  onChange: (patch: Partial<ScheduleValue>) => void;
}

const MODES: { id: ScheduleMode; label: string }[] = [
  { id: "interval", label: "Interval" },
  { id: "daily", label: "Daily" },
  { id: "custom", label: "Custom cron" },
];

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

export function SchedulePicker({ value, onChange }: SchedulePickerProps) {
  const setMode = (mode: ScheduleMode) => onChange({ scheduleMode: mode });

  return (
    <div className="flex flex-col gap-4">
      <div className="inline-flex w-fit rounded-lg border bg-muted/40 p-1">
        {MODES.map((mode) => (
          <button
            key={mode.id}
            type="button"
            onClick={() => setMode(mode.id)}
            className={cn(
              "rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
              value.scheduleMode === mode.id
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {mode.label}
          </button>
        ))}
      </div>

      {value.scheduleMode === "interval" && (
        <div className="flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <Label htmlFor="interval">Repeat every</Label>
            <span className="text-sm font-medium text-foreground">
              {value.intervalHours}{" "}
              {value.intervalHours === 1 ? "hour" : "hours"}
            </span>
          </div>
          <Slider
            id="interval"
            min={1}
            max={168}
            step={1}
            value={[value.intervalHours]}
            onValueChange={([v]) => onChange({ intervalHours: v ?? 1 })}
          />
        </div>
      )}

      {value.scheduleMode === "daily" && (
        <div className="flex flex-col gap-3">
          <Label>Trigger times (24h)</Label>
          <div className="flex flex-wrap gap-2">
            {value.dailyTimes.map((time, i) => (
              <div
                key={time}
                className="flex items-center gap-1 rounded-lg border bg-background px-2 py-1"
              >
                <input
                  type="time"
                  value={time}
                  onChange={(e) => {
                    const next = [...value.dailyTimes];
                    next[i] = e.target.value;
                    onChange({ dailyTimes: next });
                  }}
                  className="bg-transparent text-sm text-foreground outline-none"
                  aria-label={`Daily trigger time ${i + 1}`}
                />
                <button
                  type="button"
                  onClick={() =>
                    onChange({
                      dailyTimes: value.dailyTimes.filter(
                        (_, idx) => idx !== i,
                      ),
                    })
                  }
                  className="text-muted-foreground hover:text-destructive"
                  aria-label={`Remove time ${time}`}
                >
                  <X className="size-3.5" />
                </button>
              </div>
            ))}
          </div>
          <div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={value.dailyTimes.length >= 12}
              onClick={() =>
                onChange({
                  dailyTimes: [...new Set([...value.dailyTimes, "12:00"])],
                })
              }
            >
              <Plus className="size-3.5" />
              Add time
            </Button>
          </div>
          {value.dailyTimes.some((t) => !TIME_RE.test(t)) && (
            <p className="text-xs text-destructive">
              All times must use the 24h HH:MM format.
            </p>
          )}
        </div>
      )}

      {value.scheduleMode === "custom" && (
        <div className="flex flex-col gap-2">
          <Label htmlFor="cron">Cron expression</Label>
          <Input
            id="cron"
            placeholder="0 */6 * * *"
            value={value.cronExpression ?? ""}
            onChange={(e) => onChange({ cronExpression: e.target.value })}
            className={cn(
              value.cronExpression &&
                !isValidCron(value.cronExpression) &&
                "border-destructive focus-visible:ring-destructive/40",
            )}
          />
          <p className="text-xs text-muted-foreground">
            Standard 5-field cron: minute hour day-of-month month day-of-week.
          </p>
          {value.cronExpression && !isValidCron(value.cronExpression) && (
            <p className="text-xs text-destructive">
              Invalid cron expression. Use exactly 5 fields (e.g.{" "}
              <code>0 9,15,21 * * *</code>).
            </p>
          )}
        </div>
      )}
    </div>
  );
}
