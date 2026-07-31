"use client";

import { useQuota } from "@/hooks/use-quota";
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

  return (
    <MultiAccountView
      snapshots={snapshots}
      cachedAt={cachedAt}
      onRefresh={mutate}
      isRefreshing={isValidating || (isLoading && !data)}
      error={error}
    />
  );
}
