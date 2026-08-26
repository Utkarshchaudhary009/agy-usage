"use client";

import { Bell, BellOff } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuota } from "@/hooks/use-quota";
import { useRealtimeQuota } from "@/hooks/use-realtime-quota";
import {
  notificationPermission,
  notifyModelExhausted,
  notifyModelReset,
  requestNotificationPermission,
} from "@/lib/notifications";
import type { QuotaSnapshot } from "@/lib/types/quota";
import { MultiAccountView } from "./multi-account-view";

interface DashboardClientProps {
  initialSnapshots: QuotaSnapshot[];
  initialCachedAt: string;
}

export function DashboardClient({
  initialSnapshots,
  initialCachedAt,
}: DashboardClientProps) {
  const {
    data,
    cachedAt: clientCachedAt,
    error,
    isLoading,
    isValidating,
    mutate,
  } = useQuota();

  // Prefer client-fetched data, fallback to initial SSR data
  const snapshots = data || initialSnapshots;
  const cachedAt = clientCachedAt || initialCachedAt;

  // Realtime: quota_cache writes (interactive fetches AND Inngest polls)
  // invalidate via a cheap cache-served refetch — never a force refresh.
  const accountIds = useMemo(
    () => snapshots.map((s) => s.accountId),
    [snapshots],
  );
  const handleInvalidate = useCallback(() => {
    void mutate(false);
  }, [mutate]);
  const { connected } = useRealtimeQuota({
    accountIds,
    onInvalidate: handleInvalidate,
  });

  // Browser notifications on exhausted/reset transitions. Previous state is
  // kept in a ref so the diff runs exactly once per snapshot refresh.
  const [alertsEnabled, setAlertsEnabled] = useState(false);
  const previousRef = useRef<QuotaSnapshot[]>(initialSnapshots);

  useEffect(() => {
    setAlertsEnabled(notificationPermission() === "granted");
  }, []);

  useEffect(() => {
    if (!alertsEnabled) return;
    const current = snapshots;
    const previousByModel = new Map(
      previousRef.current.flatMap((s) =>
        s.models.map((m) => [`${s.accountId}:${m.modelId}`, m] as const),
      ),
    );

    for (const snapshot of current) {
      for (const model of snapshot.models) {
        const previous = previousByModel.get(
          `${snapshot.accountId}:${model.modelId}`,
        );
        if (!previous) continue;
        if (!previous.isExhausted && model.isExhausted) {
          notifyModelExhausted(
            model.displayName || model.label,
            model.resetTime,
          );
        }
        if (
          previous.remainingPercentage < 0.999 &&
          model.remainingPercentage >= 0.999
        ) {
          notifyModelReset(model.displayName || model.label);
        }
      }
    }
    previousRef.current = current;
  }, [snapshots, alertsEnabled]);

  const toggleAlerts = async () => {
    const result = await requestNotificationPermission();
    setAlertsEnabled(result === "granted");
  };

  return (
    <div className="relative space-y-3">
      <div className="flex items-center justify-end gap-2">
        <span
          className="inline-flex items-center gap-1.5 text-xs text-muted-foreground"
          title={
            connected
              ? "Live updates connected"
              : "Live updates offline — polling fallback active"
          }
        >
          <span
            className={`size-2 rounded-full ${
              connected ? "bg-emerald-500" : "bg-muted-foreground/40"
            }`}
            aria-hidden
          />
          {connected ? "Live" : "Polling"}
        </span>
        <button
          type="button"
          onClick={() => void toggleAlerts()}
          className="inline-flex items-center gap-1.5 rounded-md border border-border px-2 py-1 text-xs text-muted-foreground hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          {alertsEnabled ? (
            <>
              <Bell className="size-3.5" aria-hidden /> Alerts on
            </>
          ) : (
            <>
              <BellOff className="size-3.5" aria-hidden /> Enable alerts
            </>
          )}
        </button>
      </div>
      <MultiAccountView
        snapshots={snapshots}
        cachedAt={cachedAt}
        onRefresh={mutate}
        isRefreshing={isValidating || (isLoading && !data)}
        error={error}
      />
    </div>
  );
}
