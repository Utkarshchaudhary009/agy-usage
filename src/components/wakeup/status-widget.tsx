"use client";

import { Clock } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { TriggerButton } from "@/components/wakeup/trigger-button";
import type { WakeupConfig } from "@/lib/types/wakeup";
import { computeNextTriggerAt } from "@/lib/wakeup/schedule-preview";

interface StatusWidgetProps {
  config: WakeupConfig;
  /** wakeup_configs.last_run_started_at — the cooldown anchor. */
  lastTriggerAt: string | null;
  lastOutcome: { success: boolean; createdAt: string } | null;
}

/**
 * Compact wakeup status card for the dashboard home. Schedule math re-runs
 * after mount (and every minute) so server/client render identically on
 * hydration, mirroring the schedule-picker preview pattern.
 */
export function StatusWidget({
  config,
  lastTriggerAt,
  lastOutcome,
}: StatusWidgetProps) {
  const [now, setNow] = useState<Date | null>(null);
  // Locale/date formatting is client-only so SSR markup matches hydration.
  const [formattedLast, setFormattedLast] = useState<string | null>(null);

  useEffect(() => {
    setNow(new Date());
    if (lastOutcome) {
      setFormattedLast(new Date(lastOutcome.createdAt).toLocaleString());
    }
    const timer = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(timer);
  }, [lastOutcome]);

  const nextTriggerAt = useMemo(
    () =>
      now === null
        ? null
        : computeNextTriggerAt(config, parseDate(lastTriggerAt), now),
    [now, config, lastTriggerAt],
  );

  return (
    <Card>
      <CardHeader className="flex-row items-start justify-between space-y-0">
        <div className="space-y-1">
          <CardTitle className="flex items-center gap-2 text-base">
            <Clock className="size-4" aria-hidden /> Wakeup
          </CardTitle>
          <CardDescription>
            {config.enabled
              ? "Keeps your selected models warm on schedule."
              : "Wakeup is currently disabled."}
          </CardDescription>
        </div>
        <Badge variant={config.enabled ? "secondary" : "outline"}>
          {config.enabled ? "enabled" : "disabled"}
        </Badge>
      </CardHeader>
      <CardContent className="space-y-4">
        <dl className="grid gap-2 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-muted-foreground">Last trigger</dt>
            <dd>
              {lastOutcome
                ? `${formattedLast ?? "…"} · ${
                    lastOutcome.success ? "succeeded" : "failed"
                  }`
                : "Never triggered"}
            </dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Next scheduled</dt>
            <dd>
              {config.enabled
                ? nextTriggerAt
                  ? formatDateTime(nextTriggerAt)
                  : "After the first run"
                : "—"}
            </dd>
          </div>
        </dl>
        <TriggerButton size="sm" disabled={!config.enabled} />
      </CardContent>
    </Card>
  );
}

function parseDate(value: string | null): Date | null {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
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
