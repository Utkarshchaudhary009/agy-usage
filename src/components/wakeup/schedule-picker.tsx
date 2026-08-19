"use client";

import { Plus, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  type ScheduleMode,
  validateCronExpression,
  type WakeupConfig,
} from "@/lib/types/wakeup";
import { clampInt, cn } from "@/lib/utils";

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

  // Stable, per-row identities so editing a time in place never remounts its
  // <input> (which would drop focus). Seeded deterministically from the initial
  // length to stay hydration-safe, then extended on add.
  const [timeIds, setTimeIds] = useState(() =>
    config.dailyTimes.map((_, i) => `time-${i}`),
  );
  const nextTimeId = useRef(config.dailyTimes.length);
  useEffect(() => {
    setTimeIds((prev) => {
      if (prev.length === config.dailyTimes.length) return prev;
      if (prev.length < config.dailyTimes.length) {
        const added = config.dailyTimes.length - prev.length;
        const newIds = Array.from(
          { length: added },
          () => `time-${nextTimeId.current++}`,
        );
        return [...prev, ...newIds];
      }
      return prev.slice(0, config.dailyTimes.length);
    });
  }, [config.dailyTimes.length]);

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
            max={168}
            step={1}
            value={config.intervalHours}
            disabled={disabled}
            onChange={(e) =>
              onChange({
                intervalHours: clampInt(
                  e.target.value,
                  1,
                  168,
                  config.intervalHours,
                ),
              })
            }
            className="w-full accent-primary"
          />
          <div className="flex justify-between text-xs text-muted-foreground">
            <span>1h</span>
            <span>168h</span>
          </div>
        </div>
      )}

      {config.scheduleMode === "daily" && (
        <div className="space-y-2">
          <span className="text-sm font-medium">Trigger times</span>
          <div className="flex flex-wrap gap-2">
            {config.dailyTimes.map((time, index) => (
              <div
                key={timeIds[index]}
                className="flex items-center gap-1 rounded-md border border-input bg-background p-1 pr-2"
              >
                <input
                  type="time"
                  value={time}
                  aria-label={`Wake-up time ${index + 1}`}
                  disabled={disabled}
                  onChange={(e) => {
                    const value = e.target.value;
                    // Keep times unique; the row key is its stable index, not the
                    // value, so editing in place never remounts the input.
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
                const used = new Set(config.dailyTimes);
                // Pick the next unused HH:MM (30-minute granularity) so the
                // button always adds a distinct row instead of silently doing
                // nothing when the seeded default is already present.
                let next = "00:00";
                outer: for (let h = 0; h < 24; h += 1) {
                  for (let m = 0; m < 60; m += 30) {
                    const candidate = `${String(h).padStart(2, "0")}:${String(
                      m,
                    ).padStart(2, "0")}`;
                    if (!used.has(candidate)) {
                      next = candidate;
                      break outer;
                    }
                  }
                }
                if (used.has(next)) return;
                onChange({ dailyTimes: [...config.dailyTimes, next] });
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
