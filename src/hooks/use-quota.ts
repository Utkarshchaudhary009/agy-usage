"use client";

import { useCallback, useEffect, useState } from "react";
import type { QuotaSnapshot } from "@/lib/types/quota";

interface UseQuotaResult {
  data: QuotaSnapshot[] | null;
  cachedAt: string | null;
  error: Error | null;
  isLoading: boolean;
  isValidating: boolean;
  mutate: (refresh?: boolean) => Promise<void>;
}

export function useQuota(): UseQuotaResult {
  const [data, setData] = useState<QuotaSnapshot[] | null>(null);
  const [cachedAt, setCachedAt] = useState<string | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isValidating, setIsValidating] = useState<boolean>(false);

  const fetchData = useCallback(async (refresh: boolean = false) => {
    setIsValidating(true);

    try {
      const url = refresh ? "/api/quota?refresh=true" : "/api/quota";
      const res = await fetch(url);
      const json = await res.json();

      if (!res.ok) {
        throw new Error(json.message || json.error || "Failed to fetch quota");
      }

      setData(json.snapshots);
      setCachedAt(json.cachedAt);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err : new Error(String(err)));
    } finally {
      setIsLoading(false);
      setIsValidating(false);
    }
  }, []);

  useEffect(() => {
    fetchData();

    // Auto-revalidate every 5 minutes
    const interval = setInterval(
      () => {
        fetchData();
      },
      5 * 60 * 1000,
    );

    return () => clearInterval(interval);
  }, [fetchData]); // Only run on mount and rely on useCallback for fetchData

  return {
    data,
    cachedAt,
    error,
    isLoading,
    isValidating,
    mutate: (refresh = true) => fetchData(refresh),
  };
}
