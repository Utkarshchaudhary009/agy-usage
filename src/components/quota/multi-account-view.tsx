"use client";

import { clsx } from "clsx";
import { AlertCircle, RefreshCw } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import type { QuotaSnapshot } from "@/lib/types/quota";
import { AccountHeader } from "./account-header";
import { CreditsCard } from "./credits-card";
import { QuotaGrid } from "./quota-grid";

interface MultiAccountViewProps {
  snapshots: QuotaSnapshot[];
  cachedAt: string;
  onRefresh: (refresh?: boolean) => Promise<void>;
  isRefreshing: boolean;
  error?: Error | null;
}

export function MultiAccountView({
  snapshots,
  cachedAt,
  onRefresh,
  isRefreshing,
  error,
}: MultiAccountViewProps) {
  const [activeTab, setActiveTab] = useState<string>(
    snapshots[0]?.accountId || "",
  );

  if (error) {
    return (
      <div className="rounded-lg border border-destructive/50 text-destructive p-4 flex flex-col gap-2">
        <div className="flex items-center gap-2 font-medium">
          <AlertCircle className="h-4 w-4" />
          <span>Error</span>
        </div>
        <div className="text-sm">
          {error.message || "Failed to load quota data. Please try again."}
          <div className="mt-4">
            <Button
              variant="outline"
              size="sm"
              onClick={() => onRefresh(true)}
              disabled={isRefreshing}
              className="text-foreground"
            >
              <RefreshCw
                className={`mr-2 h-4 w-4 ${isRefreshing ? "animate-spin" : ""}`}
              />
              Try Again
            </Button>
          </div>
        </div>
      </div>
    );
  }

  if (snapshots.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center p-8 border rounded-lg bg-card text-center min-h-[400px]">
        <h2 className="text-2xl font-semibold mb-2">No Accounts Linked</h2>
        <p className="text-muted-foreground mb-6 max-w-md">
          You need to link a Google account to view your Cloud Code AI quota.
        </p>
        <Button asChild>
          <Link href="/accounts">Link Google Account</Link>
        </Button>
      </div>
    );
  }

  // If there's only one account, just show it without tabs
  if (snapshots.length === 1) {
    const snapshot = snapshots[0];
    return (
      <div className="space-y-6">
        <AccountHeader
          email={snapshot.email}
          cachedAt={cachedAt}
          onRefresh={() => onRefresh(true)}
          isRefreshing={isRefreshing}
        />

        {snapshot.promptCredits && (
          <div className="max-w-md">
            <CreditsCard
              credits={snapshot.promptCredits}
              planType={snapshot.planType}
            />
          </div>
        )}

        <QuotaGrid models={snapshot.models} onRefresh={() => onRefresh(true)} />
      </div>
    );
  }

  const activeSnapshot =
    snapshots.find((s) => s.accountId === activeTab) || snapshots[0];

  // Multiple accounts - use tabs
  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <h2 className="text-xl font-semibold">Your Accounts</h2>
        <Button
          variant="outline"
          onClick={() => onRefresh(true)}
          disabled={isRefreshing}
          size="sm"
        >
          <RefreshCw
            className={`mr-2 h-4 w-4 ${isRefreshing ? "animate-spin" : ""}`}
          />
          Refresh All
        </Button>
      </div>

      <div className="w-full">
        <div className="flex flex-wrap gap-2 mb-4 p-1 bg-muted rounded-lg w-max max-w-full overflow-x-auto">
          {snapshots.map((snapshot) => (
            <button
              type="button"
              key={snapshot.accountId}
              onClick={() => setActiveTab(snapshot.accountId)}
              className={clsx(
                "px-3 py-1.5 text-sm font-medium rounded-md transition-all",
                activeTab === snapshot.accountId
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:bg-background/50 hover:text-foreground",
              )}
            >
              {snapshot.email}
            </button>
          ))}
        </div>

        <div className="space-y-6">
          <div className="text-sm text-muted-foreground">
            Last updated: {new Date(cachedAt).toLocaleTimeString()}
          </div>

          {activeSnapshot.promptCredits && (
            <div className="max-w-md">
              <CreditsCard
                credits={activeSnapshot.promptCredits}
                planType={activeSnapshot.planType}
              />
            </div>
          )}

          <QuotaGrid
            models={activeSnapshot.models}
            onRefresh={() => onRefresh(true)}
          />
        </div>
      </div>
    </div>
  );
}
