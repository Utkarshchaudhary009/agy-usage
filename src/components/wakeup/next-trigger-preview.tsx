"use client";

import { CalendarClock } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { WakeupConfigInput } from "@/lib/types/wakeup";
import { parseCronExpression } from "@/lib/wakeup/cron";
import { formatRelativeTime, formatUtcDateTime } from "@/lib/wakeup/format";
import { describeSchedule, getNextTriggerAt } from "@/lib/wakeup/schedule";
import { LocalTime } from "./local-time";

interface NextTriggerPreviewProps {
  config: WakeupConfigInput;
}

const REFRESH_INTERVAL_MS = 30_000;

function explainMissingTrigger(config: WakeupConfigInput): string {
  if (!config.enabled) return "Automatic wakeup is off.";
  if (config.selectedModels.length === 0) return "No models selected.";
  if (config.selectedAccountIds.length === 0) return "No accounts selected.";
  if (config.scheduleMode === "daily" && config.dailyTimes.length === 0) {
    return "No daily times added.";
  }
  if (config.scheduleMode === "custom") {
    if (!config.cronExpression) return "Add a cron expression.";
    const parsed = parseCronExpression(config.cronExpression);
    if (!parsed.ok) return parsed.error;
    return "This cron expression has no upcoming run.";
  }
  return "This schedule will never run.";
}

export function NextTriggerPreview({ config }: NextTriggerPreviewProps) {
  // `now` stays null until after mount: computing it during render would make
  // the server and client markup disagree (and go stale immediately).
  const [now, setNow] = useState<Date | null>(null);

  useEffect(() => {
    setNow(new Date());
    const timer = setInterval(() => setNow(new Date()), REFRESH_INTERVAL_MS);
    return () => clearInterval(timer);
  }, []);

  const nextTriggerAt = useMemo(
    () => (now ? getNextTriggerAt(config, now) : null),
    [config, now],
  );

  const scheduleDescription = describeSchedule(config);

  return (
    <div className="flex items-start gap-3 rounded-lg bg-muted/50 p-3 text-sm">
      <CalendarClock
        aria-hidden="true"
        className="mt-0.5 size-4 shrink-0 text-muted-foreground"
      />
      <div className="flex min-w-0 flex-col gap-0.5">
        <span className="font-medium">Next trigger</span>
        {/* Only the value is a live region, so edits elsewhere in the form do
            not trigger a full re-read. */}
        <span aria-live="polite" className="flex flex-col gap-0.5">
          {!now ? (
            <span className="text-muted-foreground">Calculating…</span>
          ) : nextTriggerAt ? (
            <>
              <span className="text-muted-foreground">
                <LocalTime value={nextTriggerAt} /> (
                {formatRelativeTime(now.getTime(), nextTriggerAt.getTime())})
              </span>
              <span className="text-xs text-muted-foreground">
                {formatUtcDateTime(nextTriggerAt)} · {scheduleDescription}
              </span>
            </>
          ) : (
            <span className="text-muted-foreground">
              {explainMissingTrigger(config)}
            </span>
          )}
        </span>
      </div>
    </div>
  );
}
