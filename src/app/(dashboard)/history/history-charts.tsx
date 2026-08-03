"use client";

import { Download } from "lucide-react";
import dynamic from "next/dynamic";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { DateRangePicker } from "@/components/charts/date-range-picker";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import type { Database } from "@/lib/types/database";
import type { QuotaSnapshotRecord, SnapshotData } from "@/lib/types/history";

const BurndownChart = dynamic(
  () =>
    import("@/components/charts/burndown-chart").then((m) => m.BurndownChart),
  {
    ssr: false,
    loading: () => <Skeleton className="h-[350px] w-full rounded-xl" />,
  },
);
const CreditsChart = dynamic(
  () => import("@/components/charts/credits-chart").then((m) => m.CreditsChart),
  {
    ssr: false,
    loading: () => <Skeleton className="h-[300px] w-full rounded-xl" />,
  },
);
const ModelComparison = dynamic(
  () =>
    import("@/components/charts/model-comparison").then(
      (m) => m.ModelComparison,
    ),
  {
    ssr: false,
    loading: () => <Skeleton className="h-[350px] w-full rounded-xl" />,
  },
);
const AccountComparison = dynamic(
  () =>
    import("@/components/charts/account-comparison").then(
      (m) => m.AccountComparison,
    ),
  {
    ssr: false,
    loading: () => <Skeleton className="h-[400px] w-full rounded-xl" />,
  },
);

interface HistoryChartsProps {
  accounts: Database["public"]["Tables"]["google_accounts"]["Row"][];
}

export function HistoryCharts({ accounts }: HistoryChartsProps) {
  const [selectedAccountId, setSelectedAccountId] = useState<string | "all">(
    "all",
  );
  const [dateRange, setDateRange] = useState<{ from: Date; to: Date }>({
    from: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000), // Default 7 days
    to: new Date(),
  });
  const [historyData, setHistoryData] = useState<
    Record<string, QuotaSnapshotRecord[]>
  >({});
  const [isLoading, setIsLoading] = useState(true);

  // Fetch history based on date range and selected account
  useEffect(() => {
    if (accounts.length === 0) {
      setIsLoading(false);
      return;
    }

    const abortController = new AbortController();

    async function fetchHistory() {
      setIsLoading(true);
      try {
        const accountsToFetch =
          selectedAccountId === "all"
            ? accounts.map((a) => a.id)
            : [selectedAccountId];
        const accountsParam = accountsToFetch.join(",");

        const res = await fetch(
          `/api/quota/history?accounts=${accountsParam}&from=${dateRange.from.toISOString()}&to=${dateRange.to.toISOString()}`,
          { signal: abortController.signal },
        );

        if (res.ok) {
          const data = await res.json();
          // data.history is a flat array of snapshots for all requested accounts
          // Group them by account_id
          const newData: Record<string, QuotaSnapshotRecord[]> = {};
          accountsToFetch.forEach((id) => {
            newData[id] = [];
          });

          if (data.history) {
            data.history.forEach((snap: QuotaSnapshotRecord) => {
              if (newData[snap.account_id]) {
                newData[snap.account_id].push(snap);
              }
            });
          }
          setHistoryData(newData);
        } else {
          const errorData = await res.json();
          toast.error(errorData.message || "Failed to load history data");
          setHistoryData({});
        }
      } catch (err: unknown) {
        if (err instanceof Error && err.name !== "AbortError") {
          toast.error("Failed to load history data");
          setHistoryData({});
        }
      } finally {
        if (!abortController.signal.aborted) {
          setIsLoading(false);
        }
      }
    }

    fetchHistory();
    return () => abortController.abort();
  }, [selectedAccountId, dateRange, accounts]);

  const currentAccountSnapshots = useMemo(() => {
    return selectedAccountId === "all"
      ? Object.values(historyData)
          .flat()
          .sort(
            (a, b) =>
              new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime(),
          )
      : historyData[selectedAccountId] || [];
  }, [historyData, selectedAccountId]);

  const handleExport = (format: "json" | "csv") => {
    if (format === "json") {
      const jsonStr = JSON.stringify(historyData, null, 2);
      const blob = new Blob([jsonStr], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `quota-history-${new Date().toISOString().split("T")[0]}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 100);
    } else {
      let csvContent =
        "account_id,timestamp,model_id,remaining_percentage,is_exhausted\n";
      for (const [accId, snapshots] of Object.entries(historyData)) {
        for (const snap of snapshots) {
          const snapshotData = snap.snapshot_data as SnapshotData;
          if (snapshotData?.models) {
            for (const model of snapshotData.models) {
              csvContent += `${accId},${snap.timestamp},${model.modelId},${model.remainingPercentage},${model.isExhausted}\n`;
            }
          }
        }
      }
      const blob = new Blob([csvContent], { type: "text/csv" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `quota-history-${new Date().toISOString().split("T")[0]}.csv`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 100);
    }
  };

  return (
    <div className="flex-1 space-y-4 p-4 md:p-8 pt-6">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between space-y-2 sm:space-y-0">
        <h2 className="text-3xl font-bold tracking-tight">
          Analytics & History
        </h2>
        <div className="flex items-center space-x-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => handleExport("csv")}
          >
            <Download className="mr-2 h-4 w-4" />
            CSV
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => handleExport("json")}
          >
            <Download className="mr-2 h-4 w-4" />
            JSON
          </Button>
        </div>
      </div>

      <div className="flex flex-col sm:flex-row space-y-2 sm:space-y-0 sm:space-x-4 items-center mb-4">
        <label className="sr-only" htmlFor="account-select">
          Select Account
        </label>
        <select
          id="account-select"
          className="flex h-9 w-full sm:w-[200px] items-center justify-between rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm ring-offset-background placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
          value={selectedAccountId}
          onChange={(e) => setSelectedAccountId(e.target.value)}
        >
          <option value="all">All Accounts</option>
          {accounts.map((acc) => (
            <option key={acc.id} value={acc.id}>
              {acc.email}
            </option>
          ))}
        </select>

        <DateRangePicker value={dateRange} onChange={setDateRange} />
      </div>

      {isLoading ? (
        <div className="h-64 flex items-center justify-center border rounded-lg border-dashed">
          <span className="text-muted-foreground">Loading chart data...</span>
        </div>
      ) : accounts.length === 0 ? (
        <div className="h-64 flex flex-col items-center justify-center border rounded-lg border-dashed">
          <p className="text-muted-foreground mb-4">
            No linked accounts found.
          </p>
        </div>
      ) : currentAccountSnapshots.length === 0 ? (
        <div className="h-64 flex flex-col items-center justify-center border rounded-lg border-dashed">
          <p className="text-muted-foreground">
            No history data for the selected period.
          </p>
        </div>
      ) : (
        <div className="grid gap-4 grid-cols-1 md:grid-cols-2 lg:grid-cols-7">
          <div className="col-span-1 lg:col-span-4 space-y-4">
            <BurndownChart snapshots={currentAccountSnapshots} />
            <CreditsChart snapshots={currentAccountSnapshots} />
          </div>
          <div className="col-span-1 lg:col-span-3 space-y-4">
            <ModelComparison snapshots={currentAccountSnapshots} />
            {selectedAccountId === "all" && accounts.length > 1 && (
              <AccountComparison
                historyData={historyData}
                accounts={accounts}
              />
            )}
          </div>
        </div>
      )}
    </div>
  );
}
