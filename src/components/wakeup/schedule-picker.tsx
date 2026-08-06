"use client";

import { ClockIcon, PlusIcon, Trash2Icon } from "lucide-react";
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
import { cn } from "@/lib/utils";
import { describeCron, validateCronExpression } from "@/lib/wakeup/cron";

export interface ScheduleState {
  scheduleMode: ScheduleMode;
  intervalHours: number;
  dailyTimes: string[];
  cronExpression: string | null;
}

interface SchedulePickerProps {
  value: ScheduleState;
  onChange: (next: ScheduleState) => void;
  disabled?: boolean;
}

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

export function SchedulePicker({
  value,
  onChange,
  disabled,
}: SchedulePickerProps) {
  function setMode(mode: ScheduleMode) {
    onChange({ ...value, scheduleMode: mode });
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="schedule-mode">Schedule mode</Label>
        <Select
          value={value.scheduleMode}
          onValueChange={(v) => setMode(v as ScheduleMode)}
          disabled={disabled}
        >
          <SelectTrigger id="schedule-mode" className="sm:w-64">
            <SelectValue placeholder="Select mode" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="interval">Interval</SelectItem>
            <SelectItem value="daily">Daily times</SelectItem>
            <SelectItem value="custom">Custom cron</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {value.scheduleMode === "interval" && (
        <div className="flex flex-col gap-3 rounded-lg border border-border p-4">
          <div className="flex items-center justify-between">
            <Label>Every</Label>
            <span className="text-sm font-medium tabular-nums">
              {value.intervalHours} hour{value.intervalHours === 1 ? "" : "s"}
            </span>
          </div>
          <Slider
            value={[value.intervalHours]}
            min={1}
            max={168}
            step={1}
            onValueChange={([v]) =>
              onChange({ ...value, intervalHours: v ?? 6 })
            }
            disabled={disabled}
          />
        </div>
      )}

      {value.scheduleMode === "daily" && (
        <div className="flex flex-col gap-2 rounded-lg border border-border p-4">
          <Label>Trigger times (24h)</Label>
          <div className="flex flex-col gap-2">
            {value.dailyTimes.map((time, idx) => (
              <div
                // biome-ignore lint/suspicious/noArrayIndexKey: rows are positional slots for editable values that may repeat, so the index is the only stable row identity
                key={`daily-time-${idx}`}
                className="flex items-center gap-2"
              >
                <Input
                  type="time"
                  value={time}
                  disabled={disabled}
                  onChange={(e) => {
                    const next = [...value.dailyTimes];
                    next[idx] = e.target.value;
                    onChange({ ...value, dailyTimes: next });
                  }}
                  className="w-32"
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  disabled={disabled || value.dailyTimes.length <= 1}
                  onClick={() => {
                    const next = value.dailyTimes.filter((_, i) => i !== idx);
                    onChange({ ...value, dailyTimes: next });
                  }}
                  aria-label="Remove time"
                >
                  <Trash2Icon />
                </Button>
              </div>
            ))}
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="self-start"
            disabled={disabled}
            onClick={() =>
              onChange({ ...value, dailyTimes: [...value.dailyTimes, "12:00"] })
            }
          >
            <PlusIcon />
            Add time
          </Button>
        </div>
      )}

      {value.scheduleMode === "custom" && (
        <div className="flex flex-col gap-2 rounded-lg border border-border p-4">
          <Label htmlFor="cron">Cron expression</Label>
          <Input
            id="cron"
            placeholder="*/30 * * * *"
            value={value.cronExpression ?? ""}
            disabled={disabled}
            onChange={(e) =>
              onChange({ ...value, cronExpression: e.target.value })
            }
          />
          <CronHint expression={value.cronExpression ?? ""} />
        </div>
      )}
    </div>
  );
}

function CronHint({ expression }: { expression: string }) {
  const trimmed = expression.trim();
  if (!trimmed) {
    return (
      <p className="text-xs text-muted-foreground">
        5 fields: minute hour day month weekday.
      </p>
    );
  }
  const result = validateCronExpression(trimmed);
  return (
    <p
      className={cn(
        "flex items-center gap-1.5 text-xs",
        result.valid ? "text-muted-foreground" : "text-destructive",
      )}
    >
      {result.valid ? (
        <>
          <ClockIcon className="size-3" />
          {describeCron(trimmed)}
        </>
      ) : (
        result.error
      )}
    </p>
  );
}

export { TIME_RE };
