"use client";

import { Calendar, Clock, Settings2 } from "lucide-react";
import { cn } from "@/lib/utils";

interface SchedulePickerProps {
  scheduleMode: "interval" | "daily" | "custom";
  intervalHours: number;
  dailyTimes: string[];
  cronExpression: string;
  onModeChange: (mode: "interval" | "daily" | "custom") => void;
  onIntervalChange: (hours: number) => void;
  onDailyTimesChange: (times: string[]) => void;
  onCronChange: (expr: string) => void;
}

const TIME_OPTIONS = [
  "00:00",
  "03:00",
  "06:00",
  "09:00",
  "12:00",
  "15:00",
  "18:00",
  "21:00",
];

export function SchedulePicker({
  scheduleMode,
  intervalHours,
  dailyTimes,
  cronExpression,
  onModeChange,
  onIntervalChange,
  onDailyTimesChange,
  onCronChange,
}: SchedulePickerProps) {
  return (
    <div className="flex flex-col gap-3">
      <h2 className="text-base font-semibold">Schedule</h2>
      <div className="flex gap-2">
        {[
          { mode: "interval" as const, label: "Interval", icon: Clock },
          { mode: "daily" as const, label: "Daily", icon: Calendar },
          { mode: "custom" as const, label: "Custom Cron", icon: Settings2 },
        ].map(({ mode, label, icon: Icon }) => (
          <button
            key={mode}
            type="button"
            onClick={() => onModeChange(mode)}
            className={cn(
              "flex items-center gap-2 rounded-lg border px-4 py-2 text-sm font-medium transition-colors",
              scheduleMode === mode
                ? "border-primary bg-primary/5 text-primary"
                : "border-border bg-card text-muted-foreground hover:bg-muted/50",
            )}
          >
            <Icon className="h-4 w-4" />
            {label}
          </button>
        ))}
      </div>

      {scheduleMode === "interval" && (
        <div className="flex flex-col gap-2">
          <label htmlFor="intervalHours" className="text-sm font-medium">
            Interval (hours)
          </label>
          <input
            id="intervalHours"
            type="number"
            min={1}
            max={24}
            value={intervalHours}
            onChange={(e) =>
              onIntervalChange(parseInt(e.target.value, 10) || 6)
            }
            className="w-24 rounded-lg border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
          />
          <span className="text-xs text-muted-foreground">
            Triggers every {intervalHours} hour{intervalHours !== 1 ? "s" : ""}
          </span>
        </div>
      )}

      {scheduleMode === "daily" && (
        <div className="flex flex-col gap-2">
          <label htmlFor="dailyTimes" className="text-sm font-medium">
            Daily Times
          </label>
          <div className="flex flex-wrap gap-2" id="dailyTimes">
            {TIME_OPTIONS.map((time) => {
              const isSelected = dailyTimes.includes(time);
              return (
                <button
                  key={time}
                  type="button"
                  aria-pressed={isSelected}
                  onClick={() => {
                    if (isSelected) {
                      onDailyTimesChange(dailyTimes.filter((t) => t !== time));
                    } else {
                      onDailyTimesChange([...dailyTimes, time]);
                    }
                  }}
                  className={cn(
                    "rounded-full border px-3 py-1 text-xs font-medium transition-colors",
                    isSelected
                      ? "border-primary bg-primary/10 text-primary"
                      : "border-border bg-card text-muted-foreground",
                  )}
                >
                  {time}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {scheduleMode === "custom" && (
        <div className="flex flex-col gap-2">
          <label htmlFor="cronExpression" className="text-sm font-medium">
            Cron Expression
          </label>
          <input
            id="cronExpression"
            type="text"
            value={cronExpression}
            onChange={(e) => onCronChange(e.target.value)}
            placeholder="0 */6 * * *"
            className="rounded-lg border bg-background px-3 py-2 text-sm font-mono outline-none focus:ring-2 focus:ring-ring"
          />
          <span className="text-xs text-muted-foreground">
            5-field cron: minute hour day-of-month month day-of-week
          </span>
        </div>
      )}
    </div>
  );
}
