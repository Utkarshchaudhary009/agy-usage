"use client";

import { ChevronDown, ChevronLeft, ChevronRight } from "lucide-react";
import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { TriggerButton } from "@/components/wakeup/trigger-button";
import type { WakeupLogEntry } from "@/lib/types/wakeup";

interface HistoryTableProps {
  accounts: { id: string; email: string }[];
}

const PAGE_SIZE = 50;
const EMPTY_STATS = {
  total24h: 0,
  succeeded24h: 0,
  total7d: 0,
  succeeded7d: 0,
};

type SortField = "createdAt" | "durationMs";
type StatusFilter = "" | "success" | "failed";

export function WakeupHistory({ accounts }: HistoryTableProps) {
  const [logs, setLogs] = useState<WakeupLogEntry[]>([]);
  const [stats, setStats] = useState(EMPTY_STATS);
  const [isLoading, setIsLoading] = useState(true);
  const [page, setPage] = useState(0);
  // Bumped to force a refetch without changing filters (e.g. after a trigger).
  const [fetchNonce, setFetchNonce] = useState(0);
  const [accountFilter, setAccountFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("");
  const [sortField, setSortField] = useState<SortField>("createdAt");
  const [sortDesc, setSortDesc] = useState(true);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);

  const emailById = useMemo(
    () => new Map(accounts.map((a) => [a.id, a.email])),
    [accounts],
  );

  const load = useCallback(
    async (signal: AbortSignal) => {
      setIsLoading(true);
      try {
        const params = new URLSearchParams({
          limit: String(PAGE_SIZE),
          offset: String(page * PAGE_SIZE),
          // Cache-buster so repeated fetches are always distinct requests.
          nonce: String(fetchNonce),
        });
        if (accountFilter) params.set("account", accountFilter);
        if (statusFilter) params.set("status", statusFilter);

        const res = await fetch(`/api/wakeup/history?${params}`, { signal });
        const json = (await res.json().catch(() => ({}))) as {
          logs?: WakeupLogEntry[];
          stats?: typeof EMPTY_STATS;
          message?: string;
        };
        if (!res.ok) {
          toast.error(json.message || "Failed to load wakeup history.");
          return;
        }
        setLogs(json.logs ?? []);
        setStats(json.stats ?? EMPTY_STATS);
        // A full page hints there may be more; next-page fetch confirms.
        setHasMore((json.logs ?? []).length === PAGE_SIZE);
      } catch (err) {
        if (err instanceof Error && err.name === "AbortError") return;
        toast.error("Network error while loading wakeup history.");
      } finally {
        if (!signal.aborted) setIsLoading(false);
      }
    },
    [page, accountFilter, statusFilter, fetchNonce],
  );

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  const sorted = useMemo(() => {
    const copy = [...logs];
    copy.sort((a, b) => {
      const dir = sortDesc ? -1 : 1;
      if (sortField === "durationMs") {
        return ((a.durationMs ?? 0) - (b.durationMs ?? 0)) * dir;
      }
      return (
        ((Date.parse(a.createdAt) || 0) - (Date.parse(b.createdAt) || 0)) * dir
      );
    });
    return copy;
  }, [logs, sortField, sortDesc]);

  const toggleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDesc((prev) => !prev);
    } else {
      setSortField(field);
      setSortDesc(field === "durationMs");
    }
  };

  const successRate = (succeeded: number, total: number) =>
    total === 0 ? "—" : `${Math.round((succeeded / total) * 100)}%`;

  return (
    <section className="space-y-4 rounded-xl bg-card p-4 ring-1 ring-foreground/10">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">Trigger history</h2>
          <p className="text-sm text-muted-foreground">
            Last 24h: {stats.succeeded24h}/{stats.total24h} succeeded (
            {successRate(stats.succeeded24h, stats.total24h)}) · Last 7 days:{" "}
            {stats.succeeded7d}/{stats.total7d} (
            {successRate(stats.succeeded7d, stats.total7d)})
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <select
            aria-label="Filter by account"
            value={accountFilter}
            onChange={(e) => {
              setAccountFilter(e.target.value);
              setPage(0);
            }}
            className="rounded-md border border-border bg-background px-3 py-2 text-sm"
          >
            <option value="">All accounts</option>
            {accounts.map((account) => (
              <option key={account.id} value={account.id}>
                {account.email}
              </option>
            ))}
          </select>
          <select
            aria-label="Filter by status"
            value={statusFilter}
            onChange={(e) => {
              setStatusFilter(e.target.value as StatusFilter);
              setPage(0);
            }}
            className="rounded-md border border-border bg-background px-3 py-2 text-sm"
          >
            <option value="">All statuses</option>
            <option value="success">Success</option>
            <option value="failed">Failed</option>
          </select>
          <TriggerButton
            size="sm"
            onTriggered={() => setFetchNonce((n) => n + 1)}
          />
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left text-muted-foreground">
              <th className="py-2 pr-3 font-medium">
                <button
                  type="button"
                  onClick={() => toggleSort("createdAt")}
                  className="hover:text-foreground"
                >
                  Timestamp{sortIndicator(sortField === "createdAt", sortDesc)}
                </button>
              </th>
              <th className="py-2 pr-3 font-medium">Account</th>
              <th className="py-2 pr-3 font-medium">Model</th>
              <th className="py-2 pr-3 font-medium">Status</th>
              <th className="py-2 pr-3 font-medium">
                <button
                  type="button"
                  onClick={() => toggleSort("durationMs")}
                  className="hover:text-foreground"
                >
                  Duration
                  {sortIndicator(sortField === "durationMs", sortDesc)}
                </button>
              </th>
              <th className="py-2 pr-3 font-medium">Error</th>
              <th className="w-8 py-2" aria-hidden />
            </tr>
          </thead>
          <tbody>
            {isLoading &&
              ["a", "b", "c", "d", "e"].map((key) => (
                <tr key={key} className="border-b border-border/50">
                  <td colSpan={7} className="py-3">
                    <div className="h-4 w-full animate-pulse rounded bg-muted" />
                  </td>
                </tr>
              ))}
            {!isLoading && sorted.length === 0 && (
              <tr>
                <td
                  colSpan={7}
                  className="py-6 text-center text-muted-foreground"
                >
                  No triggers recorded yet.
                </td>
              </tr>
            )}
            {!isLoading &&
              sorted.map((log) => {
                const isExpanded = expandedId === log.id;
                const detail =
                  log.error ||
                  (log.responsePreview
                    ? `Model replied: ${log.responsePreview}`
                    : null);
                return (
                  <Fragment key={log.id}>
                    <tr
                      className="cursor-pointer border-b border-border/50 hover:bg-muted/40"
                      onClick={() => setExpandedId(isExpanded ? null : log.id)}
                    >
                      <td className="py-2 pr-3 whitespace-nowrap">
                        {new Date(log.createdAt).toLocaleString()}
                      </td>
                      <td className="max-w-40 truncate py-2 pr-3">
                        {log.accountId
                          ? (emailById.get(log.accountId) ??
                            shortId(log.accountId))
                          : "—"}
                      </td>
                      <td className="py-2 pr-3">{log.modelId}</td>
                      <td className="py-2 pr-3">
                        <Badge
                          variant={log.success ? "secondary" : "destructive"}
                        >
                          {log.success ? "success" : "failed"}
                        </Badge>
                      </td>
                      <td className="py-2 pr-3 whitespace-nowrap">
                        {formatDuration(log.durationMs)}
                      </td>
                      <td className="max-w-48 truncate py-2 pr-3 text-muted-foreground">
                        {log.error ?? "—"}
                      </td>
                      <td className="py-2 text-muted-foreground">
                        {detail ? (
                          isExpanded ? (
                            <ChevronDown className="size-4" aria-hidden />
                          ) : (
                            <ChevronRight className="size-4" aria-hidden />
                          )
                        ) : null}
                      </td>
                    </tr>
                    {isExpanded && detail && (
                      <tr className="border-b border-border/50">
                        <td colSpan={7} className="pb-3">
                          <p className="text-xs break-words text-muted-foreground">
                            {detail}
                          </p>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
          </tbody>
        </table>
      </div>

      <div className="flex items-center justify-end gap-2">
        <Button
          variant="outline"
          size="sm"
          disabled={page === 0 || isLoading}
          onClick={() => setPage((p) => Math.max(0, p - 1))}
        >
          <ChevronLeft aria-hidden /> Previous
        </Button>
        <span className="text-sm text-muted-foreground">Page {page + 1}</span>
        <Button
          variant="outline"
          size="sm"
          disabled={!hasMore || isLoading}
          onClick={() => setPage((p) => p + 1)}
        >
          Next <ChevronRight aria-hidden />
        </Button>
      </div>
    </section>
  );
}

function sortIndicator(active: boolean, desc: boolean) {
  if (!active) return "";
  return desc ? " ↓" : " ↑";
}

function formatDuration(ms: number | null): string {
  if (ms === null) return "—";
  return ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${ms}ms`;
}

function shortId(id: string): string {
  return id.slice(0, 8);
}
