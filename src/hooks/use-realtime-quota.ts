"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

/** Trailing-coalesce window for burst invalidations (e.g. poll batches). */
const DEBOUNCE_MS = 1500;

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
  const [connected, setConnected] = useState(false);

  // Membership key: canonicalized so ordering changes don't resubscribe, and
  // the subscription filter only cares about which accounts are watched.
  const accountKey = useMemo(
    () => [...new Set(accountIds)].sort().join(","),
    [accountIds],
  );

  // One background poll updates several accounts in quick succession; coalesce
  // the burst into a single trailing refetch.
  const onInvalidateRef = useRef(onInvalidate);
  useEffect(() => {
    onInvalidateRef.current = onInvalidate;
  }, [onInvalidate]);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const debouncedInvalidate = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      onInvalidateRef.current();
    }, DEBOUNCE_MS);
  }, []);
  useEffect(
    () => () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    },
    [],
  );

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
          debouncedInvalidate();
        },
      )
      .subscribe((status) => {
        setConnected(status === "SUBSCRIBED");
      });

    return () => {
      void supabase.removeChannel(channel);
      setConnected(false);
    };
  }, [supabase, accountKey, debouncedInvalidate]);

  return { connected };
}
