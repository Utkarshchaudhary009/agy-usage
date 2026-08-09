"use client";

import { Plus, X } from "lucide-react";
import { useState } from "react";
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
import type { ScheduleMode, WakeupConfig } from "@/lib/types/wakeup";
import { validateCronExpression } from "@/lib/wakeup/cron-validation";
import { formatNextTrigger } from "@/lib/wakeup/schedule-preview";

interface SchedulePickerProps {
  config: WakeupConfig;
  onChange: (patch: Partial<WakeupConfig>) => void;
}

const SCHEDULE_OPTIONS: Array<{ value: ScheduleMode; label: string }> = [
  { value: "interval", label: "Every N hours" },
  { value: "daily", label: "Specific times daily" },
  { value: "custom", label: "Custom cron" },
];

export function SchedulePicker({ config, onChange }: SchedulePickerProps) {
  const [cronError, setCronError] = useState<string | null>(null);

  function handleCronChange(value: string) {
    onChange({ cronExpression: value });
    if (!value.trim()) {
      setCronError(null);
      return;
    }
    const result = validateCronExpression(value);
    setCronError(result.valid ? null : (result.error ?? "Invalid cron."));
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-2 sm:grid-cols-[200px_1fr] sm:items-center">
        <Label htmlFor="schedule-mode">Schedule mode</Label>
        <Select
          value={config.scheduleMode}
          onValueChange={(value) =>
            onChange({ scheduleMode: value as ScheduleMode })
          }
        >
          <SelectTrigger id="schedule-mode" className="sm:max-w-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {SCHEDULE_OPTIONS.map((opt) => (
              <SelectItem key={opt.value} value={opt.value}>
                {opt.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {config.scheduleMode === "interval" && (
        <div className="grid gap-3 sm:grid-cols-[200px_1fr] sm:items-center">
          <Label htmlFor="interval-slider">
            Every {config.intervalHours} hour
            {config.intervalHours === 1 ? "" : "s"}
          </Label>
          <Slider
            id="interval-slider"
            min={1}
            max={168}
            step={1}
            value={[config.intervalHours]}
            onValueChange={([v]) => onChange({ intervalHours: v })}
          />
        </div>
      )}

      {config.scheduleMode === "daily" && (
        <div className="flex flex-col gap-2">
          <Label>Daily trigger times (24h)</Label>
          <div className="flex flex-wrap gap-2">
            {config.dailyTimes.map((time) => (
              <div
                key={time}
                className="flex items-center gap-1 rounded-lg border bg-card px-2 py-1"
              >
                <span className="font-mono text-sm">{time}</span>
                <button
                  type="button"
                  aria-label={`Remove ${time}`}
                  className="text-muted-foreground hover:text-destructive"
                  onClick={() =>
                    onChange({
                      dailyTimes: config.dailyTimes.filter((t) => t !== time),
                    })
                  }
                >
                  <X className="size-3.5" />
                </button>
              </div>
            ))}
          </div>
          <DailyTimeAdder
            onAdd={(time) => {
              if (config.dailyTimes.includes(time)) return;
              const times = [...config.dailyTimes, time].sort();
              onChange({ dailyTimes: times });
            }}
          />
        </div>
      )}

      {config.scheduleMode === "custom" && (
        <div className="flex flex-col gap-2">
          <Label htmlFor="cron-input">Cron expression (5 fields)</Label>
          <Input
            id="cron-input"
            value={config.cronExpression ?? ""}
            placeholder="0 * * * *"
            aria-invalid={cronError ? true : undefined}
            onChange={(e) => handleCronChange(e.target.value)}
          />
          {cronError ? (
            <p className="text-xs text-destructive">{cronError}</p>
          ) : config.cronExpression ? (
            <p className="text-xs text-muted-foreground">
              {validateCronExpression(config.cronExpression).description}
            </p>
          ) : null}
        </div>
      )}

      <p className="text-xs text-muted-foreground">
        {formatNextTrigger(config)}
      </p>
    </div>
  );
}

function DailyTimeAdder({ onAdd }: { onAdd: (time: string) => void }) {
  const [value, setValue] = useState("12:00");

  function handleAdd() {
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(value)) return;
    onAdd(value);
  }

  return (
    <div className="flex items-center gap-2">
      <Input
        type="time"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        className="w-32"
      />
      <Button type="button" variant="outline" size="sm" onClick={handleAdd}>
        <Plus />
        Add time
      </Button>
    </div>
  );
}
