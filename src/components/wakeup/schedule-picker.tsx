"use client";

import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import type { WakeupConfig } from "@/lib/types/wakeup";
import { cn } from "@/lib/utils";
import { describeCron, isValidCronExpression } from "@/lib/wakeup/cron";
import { SCHEDULE_MODES } from "@/lib/wakeup/models";
import { computeNextTriggerAt } from "@/lib/wakeup/schedule-preview";

interface SchedulePickerProps {
  draft: WakeupConfig;
  lastTriggerAt: Date | null;
  onChange: (patch: Partial<WakeupConfig>) => void;
}

export function SchedulePicker({
  draft,
  lastTriggerAt,
  onChange,
}: SchedulePickerProps) {
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2 bg-muted rounded-lg p-1">
        {SCHEDULE_MODES.map((mode) => (
          <Button
            key={mode.value}
            variant={draft.scheduleMode === mode.value ? "default" : "ghost"}
            size="sm"
            aria-pressed={draft.scheduleMode === mode.value}
            title={mode.description}
            onClick={() => onChange({ scheduleMode: mode.value })}
          >
            {mode.label}
          </Button>
        ))}
      </div>

      {draft.scheduleMode === "interval" && (
        <IntervalInput
          hours={draft.intervalHours}
          onChange={(hours) => onChange({ intervalHours: hours })}
        />
      )}

      {draft.scheduleMode === "daily" && (
        <DailyTimesInput
          times={draft.dailyTimes}
          onChange={(times) => onChange({ dailyTimes: times })}
        />
      )}

      {draft.scheduleMode === "custom" && (
        <CronInput
          value={draft.cronExpression ?? ""}
          onChange={(expression) =>
            onChange({
              cronExpression: expression.trim() ? expression : null,
            })
          }
        />
      )}

      <NextTriggerPreview draft={draft} lastTriggerAt={lastTriggerAt} />
    </div>
  );
}

interface IntervalInputProps {
  hours: number;
  onChange: (hours: number) => void;
}

function IntervalInput({ hours, onChange }: IntervalInputProps) {
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-3">
        <label
          className="text-sm text-muted-foreground"
          htmlFor="wakeup-interval-hours"
        >
          Trigger every
        </label>
        <input
          id="wakeup-interval-hours"
          type="number"
          min={1}
          max={168}
          value={hours}
          onChange={(event) => {
            const parsed = Number.parseInt(event.target.value, 10);
            if (!Number.isNaN(parsed)) {
              onChange(Math.min(168, Math.max(1, parsed)));
            }
          }}
          className="w-20 rounded-md border border-border bg-background px-2 py-1 text-sm text-foreground outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
        />
        <span className="text-sm text-muted-foreground">hours</span>
      </div>
      <input
        type="range"
        min={1}
        max={24}
        step={1}
        value={Math.min(hours, 24)}
        aria-label="Interval in hours"
        aria-valuetext={`${Math.min(hours, 24)} hours`}
        onChange={(event) => onChange(Number.parseInt(event.target.value, 10))}
        className="w-full accent-[var(--primary)]"
      />
      <p className="text-xs text-muted-foreground">
        Runs are checked hourly; the cooldown window still applies.
      </p>
    </div>
  );
}

interface DailyTimesInputProps {
  times: string[];
  onChange: (times: string[]) => void;
}

function DailyTimesInput({ times, onChange }: DailyTimesInputProps) {
  const sorted = [...times].sort();

  const addTime = () => {
    // First full hour not already present keeps slots distinct.
    for (let hour = 0; hour < 24; hour++) {
      const candidate = `${String(hour).padStart(2, "0")}:00`;
      if (!sorted.includes(candidate)) {
        onChange([...sorted, candidate]);
        return;
      }
    }
  };

  const updateTime = (index: number, value: string) => {
    // Replace in place but never introduce a duplicate: a colliding edit snaps
    // back, keeping list entries unique so `time` is a safe React key.
    const next = sorted.filter((_, i) => i !== index);
    if (next.includes(value)) return;
    next.push(value);
    onChange(next.sort());
  };

  const removeTime = (time: string) => {
    onChange(sorted.filter((t) => t !== time));
  };

  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">
        Triggers fire at these local times each day.
      </p>
      {sorted.length === 0 && (
        <p className="text-destructive text-sm">
          Add at least one time for the daily schedule.
        </p>
      )}
      <div className="flex flex-wrap items-center gap-2">
        {sorted.map((time, index) => (
          <span key={time} className="flex items-center">
            <label className="sr-only" htmlFor={`daily-time-${index}`}>
              Daily trigger time {index + 1}
            </label>
            <input
              id={`daily-time-${index}`}
              type="time"
              value={time}
              onChange={(event) => updateTime(index, event.target.value)}
              className="rounded-md border border-border bg-background px-2 py-1 text-sm text-foreground outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
            />
            <Button
              variant="ghost"
              size="icon-xs"
              className="ml-1"
              aria-label={`Remove ${time}`}
              onClick={() => removeTime(time)}
            >
              ×
            </Button>
          </span>
        ))}
        <Button variant="outline" size="sm" onClick={addTime}>
          Add time
        </Button>
      </div>
    </div>
  );
}

interface CronInputProps {
  value: string;
  onChange: (value: string) => void;
}

function CronInput({ value, onChange }: CronInputProps) {
  // Single pass per render: validity gate plus human-readable description.
  const state = useMemo(() => {
    if (!isValidCronExpression(value)) {
      return { valid: false, description: "" };
    }
    return { valid: true, description: describeCron(value) };
  }, [value]);

  return (
    <div className="space-y-2">
      <label htmlFor="wakeup-cron" className="block space-y-1.5">
        <span className="text-sm font-medium">Cron expression</span>
        <input
          id="wakeup-cron"
          type="text"
          value={value}
          placeholder="e.g. 0 9,15,21 * * *"
          onChange={(event) => onChange(event.target.value)}
          spellCheck={false}
          aria-invalid={!state.valid}
          aria-describedby="wakeup-cron-hint"
          className="w-full rounded-md border border-border bg-background px-3 py-2 font-mono text-sm text-foreground outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
        />
      </label>
      <p
        id="wakeup-cron-hint"
        className={cn(
          "text-xs",
          state.valid ? "text-muted-foreground" : "text-destructive",
        )}
      >
        {state.valid
          ? state.description
          : "Five fields required: minute hour day-of-month month day-of-week."}
      </p>
    </div>
  );
}

interface NextTriggerPreviewProps {
  draft: WakeupConfig;
  lastTriggerAt: Date | null;
}

function NextTriggerPreview({ draft, lastTriggerAt }: NextTriggerPreviewProps) {
  // Rendered only after mount: relative-time math differs between server and
  // client clocks and would otherwise cause hydration mismatches. `now`
  // refreshes every minute so long-open tabs stay accurate.
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    setNow(new Date());
    const timer = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(timer);
  }, []);

  const preview = useMemo(() => {
    if (!now || !draft.enabled) return null;
    return computeNextTriggerAt(draft, lastTriggerAt, now);
  }, [now, draft, lastTriggerAt]);

  if (!draft.enabled) return null;

  return (
    <div className="rounded-lg bg-muted/50 px-3 py-2 text-sm">
      {draft.scheduleMode === "interval" && !preview && !lastTriggerAt ? (
        <span className="text-muted-foreground">
          Every {draft.intervalHours} hour
          {draft.intervalHours === 1 ? "" : "s"} — first run after saving.
        </span>
      ) : preview ? (
        <>
          <span className="text-muted-foreground">Next trigger: </span>
          <span className="font-medium">{formatDateTime(preview)}</span>
        </>
      ) : (
        <span className="text-muted-foreground">
          No upcoming trigger with this schedule.
        </span>
      )}
    </div>
  );
}

function formatDateTime(date: Date): string {
  return date.toLocaleString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}
