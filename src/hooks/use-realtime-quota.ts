"use client";

import { useEffect, useMemo, useState } from "react";
import { useRealtimeClient } from "@/components/providers/realtime-provider";

interface UseRealtimeQuotaOptions {
  accountIds: string[];
  /**
   * Called whenever any subscribed account's cache row changes. Pass a stable
   * callback (useCallback) — identity changes resubscribe the channel.
   */
  onInvalidate: () => void;
}

interface UseRealtimeQuotaResult {
  /** ISO timestamp of the last received change, null until one arrives. */
  lastEventAt: string | null;
  connected: boolean;
}

/**
 * Subscribes to quota_cache postgres_changes for the given accounts. The
 * server writes this table on every user-facing fetch AND on background
 * Inngest polls, so subscribers see fresh data without polling.
 *
 * Callers should react to onInvalidate with a cheap non-forced refetch
 * (cache-served) rather than a force refresh to respect API rate limits.
 */
export function useRealtimeQuota({
  accountIds,
  onInvalidate,
}: UseRealtimeQuotaOptions): UseRealtimeQuotaResult {
  const supabase = useRealtimeClient();
  const [lastEventAt, setLastEventAt] = useState<string | null>(null);
  const [connected, setConnected] = useState(false);

  // Membership key: the subscription filter only cares about which accounts
  // are watched, so array identity churn alone must not resubscribe.
  const accountKey = useMemo(() => accountIds.join(","), [accountIds]);

  useEffect(() => {
    if (!supabase || accountKey === "") {
      setConnected(false);
      return;
    }

    const channel = supabase
      .channel("quota-cache-updates")
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "quota_cache",
          filter: `account_id=in.(${accountKey})`,
        },
        () => {
          setLastEventAt(new Date().toISOString());
          onInvalidate();
        },
      )
      .subscribe((status) => {
        setConnected(status === "SUBSCRIBED");
      });

    return () => {
      void supabase.removeChannel(channel);
      setConnected(false);
    };
  }, [supabase, accountKey, onInvalidate]);

  return { lastEventAt, connected };
}
