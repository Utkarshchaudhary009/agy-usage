"use client";

import { Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  type ScheduleMode,
  validateCronExpression,
  type WakeupConfig,
} from "@/lib/types/wakeup";
import { cn } from "@/lib/utils";

interface SchedulePickerProps {
  config: WakeupConfig;
  onChange: (patch: Partial<WakeupConfig>) => void;
  disabled?: boolean;
}

const MODE_OPTIONS: { value: ScheduleMode; label: string }[] = [
  { value: "interval", label: "Interval" },
  { value: "daily", label: "Daily" },
  { value: "custom", label: "Custom cron" },
];

export function SchedulePicker({
  config,
  onChange,
  disabled,
}: SchedulePickerProps) {
  const setMode = (mode: ScheduleMode) => onChange({ scheduleMode: mode });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        {MODE_OPTIONS.map((option) => (
          <Button
            key={option.value}
            type="button"
            variant={
              config.scheduleMode === option.value ? "default" : "outline"
            }
            size="sm"
            disabled={disabled}
            aria-pressed={config.scheduleMode === option.value}
            onClick={() => setMode(option.value)}
          >
            {option.label}
          </Button>
        ))}
      </div>

      {config.scheduleMode === "interval" && (
        <div className="space-y-2">
          <label className="text-sm font-medium" htmlFor="interval-hours">
            Every {config.intervalHours}{" "}
            {config.intervalHours === 1 ? "hour" : "hours"}
          </label>
          <input
            id="interval-hours"
            type="range"
            min={1}
            max={24}
            step={1}
            value={config.intervalHours}
            disabled={disabled}
            onChange={(e) =>
              onChange({ intervalHours: Number(e.target.value) })
            }
            className="w-full accent-primary"
          />
          <div className="flex justify-between text-xs text-muted-foreground">
            <span>1h</span>
            <span>24h</span>
          </div>
        </div>
      )}

      {config.scheduleMode === "daily" && (
        <div className="space-y-2">
          <span className="text-sm font-medium">Trigger times</span>
          <div className="flex flex-wrap gap-2">
            {config.dailyTimes.map((time, index) => (
              <div
                key={time}
                className="flex items-center gap-1 rounded-md border border-input bg-background p-1 pr-2"
              >
                <input
                  type="time"
                  value={time}
                  disabled={disabled}
                  onChange={(e) => {
                    const value = e.target.value;
                    // Keep times unique so each row has a stable, collision-free key.
                    if (
                      value &&
                      config.dailyTimes.some(
                        (t, i) => i !== index && t === value,
                      )
                    ) {
                      return;
                    }
                    const next = [...config.dailyTimes];
                    next[index] = value;
                    onChange({ dailyTimes: next });
                  }}
                  className="bg-transparent text-sm focus:outline-none"
                />
                <button
                  type="button"
                  aria-label={`Remove ${time}`}
                  disabled={disabled || config.dailyTimes.length <= 1}
                  onClick={() => {
                    onChange({
                      dailyTimes: config.dailyTimes.filter(
                        (_, i) => i !== index,
                      ),
                    });
                  }}
                  className="text-muted-foreground hover:text-foreground disabled:opacity-40"
                >
                  <X className="size-4" />
                </button>
              </div>
            ))}
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={disabled}
              onClick={() => {
                const added = "12:00";
                // Avoid duplicate times so each row keeps a unique key.
                if (config.dailyTimes.includes(added)) return;
                onChange({ dailyTimes: [...config.dailyTimes, added] });
              }}
            >
              <Plus className="size-4" />
              Add time
            </Button>
          </div>
        </div>
      )}

      {config.scheduleMode === "custom" && (
        <div className="space-y-2">
          <label className="text-sm font-medium" htmlFor="cron-expression">
            Cron expression
          </label>
          <Input
            id="cron-expression"
            placeholder="0 * * * *"
            value={config.cronExpression ?? ""}
            disabled={disabled}
            onChange={(e) =>
              onChange({ cronExpression: e.target.value || null })
            }
          />
          <CronHint expression={config.cronExpression} />
        </div>
      )}
    </div>
  );
}

function CronHint({ expression }: { expression: string | null }) {
  if (!expression || !expression.trim()) {
    return (
      <p className="text-xs text-muted-foreground">
        Standard 5-field cron (minute hour day month weekday).
      </p>
    );
  }

  const result = validateCronExpression(expression);
  return (
    <p
      className={cn(
        "text-xs",
        result.valid ? "text-muted-foreground" : "text-destructive",
      )}
    >
      {result.valid ? "Valid cron expression." : result.error}
    </p>
  );
}
