"use client";

import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";

interface AccountHeaderProps {
  email: string;
  cachedAt: string;
  onRefresh: () => void;
  isRefreshing: boolean;
}

export function AccountHeader({
  email,
  cachedAt,
  onRefresh,
  isRefreshing,
}: AccountHeaderProps) {
  const formattedTime = new Date(cachedAt).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });

  return (
    <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 p-4 border rounded-lg bg-card text-card-foreground shadow-sm">
      <div>
        <h2 className="text-xl font-semibold tracking-tight">{email}</h2>
        <p className="text-sm text-muted-foreground mt-1">
          Last updated: {formattedTime}
        </p>
      </div>

      <Button
        variant="outline"
        onClick={onRefresh}
        disabled={isRefreshing}
        className="shrink-0"
      >
        <RefreshCw
          className={`mr-2 h-4 w-4 ${isRefreshing ? "animate-spin" : ""}`}
        />
        {isRefreshing ? "Refreshing..." : "Refresh"}
      </Button>
    </div>
  );
}
