"use client";

import { useMemo } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import type { Database } from "@/lib/types/database";
import type { QuotaSnapshotRecord, SnapshotData } from "@/lib/types/history";

interface AccountComparisonProps {
  historyData: Record<string, QuotaSnapshotRecord[]>;
  accounts: Database["public"]["Tables"]["google_accounts"]["Row"][];
}

const COLORS = [
  "#2563eb", // blue-600
  "#dc2626", // red-600
  "#16a34a", // green-600
  "#d97706", // amber-600
  "#9333ea", // purple-600
];

export function AccountComparison({
  historyData,
  accounts,
}: AccountComparisonProps) {
  const chartData = useMemo(() => {
    // Get the latest snapshot for each account
    const latestByAccount = new Map<string, QuotaSnapshotRecord>();

    for (const [accountId, snapshots] of Object.entries(historyData)) {
      if (snapshots && snapshots.length > 0) {
        // Sort by timestamp desc and pick the first
        const latest = [...snapshots].sort(
          (a, b) =>
            new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime(),
        )[0];
        latestByAccount.set(accountId, latest);
      }
    }

    // Find all unique models across all accounts
    const allModelIds = new Set<string>();
    latestByAccount.forEach((snap) => {
      const snapshotData = snap.snapshot_data as SnapshotData;
      if (snapshotData?.models) {
        for (const m of snapshotData.models) {
          allModelIds.add(m.modelId);
        }
      }
    });

    // Transform to recharts format
    return Array.from(allModelIds).map((modelId) => {
      const entry: Record<string, string | number> = {
        name: modelId.replace("claude-", "").replace("gemini-", ""),
        fullId: modelId,
      };

      accounts.forEach((acc) => {
        const snap = latestByAccount.get(acc.id);
        if (snap) {
          const snapshotData = snap.snapshot_data as SnapshotData;
          const model = snapshotData?.models?.find(
            (m) => m.modelId === modelId,
          );
          if (model) {
            entry[acc.email] = model.remainingPercentage * 100;
          } else {
            entry[acc.email] = 0;
          }
        } else {
          entry[acc.email] = 0;
        }
      });

      return entry;
    });
  }, [historyData, accounts]);

  if (accounts.length < 2) {
    return null;
  }

  if (chartData.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Account Comparison</CardTitle>
          <CardDescription>Current quota across accounts</CardDescription>
        </CardHeader>
        <CardContent className="h-[300px] flex items-center justify-center">
          <p className="text-muted-foreground">No data available</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Account Comparison</CardTitle>
        <CardDescription>Side-by-side quota comparison</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="h-[350px] w-full">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart
              data={chartData}
              margin={{ top: 5, right: 30, left: 20, bottom: 5 }}
            >
              <CartesianGrid
                strokeDasharray="3 3"
                opacity={0.2}
                vertical={false}
              />
              <XAxis dataKey="name" tick={{ fontSize: 12 }} tickMargin={10} />
              <YAxis
                tickFormatter={(val) => `${val}%`}
                domain={[0, 100]}
                tick={{ fontSize: 12 }}
              />
              <Tooltip
                // biome-ignore lint/suspicious/noExplicitAny: recharts tooltip formatter signature is complex
                formatter={(value: any) => [
                  `${Number(value).toFixed(1)}%`,
                  undefined,
                ]}
                labelFormatter={(label, payload) =>
                  payload[0]?.payload.fullId || label
                }
                contentStyle={{
                  borderRadius: "6px",
                  border: "1px solid var(--border)",
                }}
              />
              <Legend wrapperStyle={{ fontSize: "12px", paddingTop: "10px" }} />

              {accounts.map((acc, index) => {
                return (
                  <Bar
                    key={acc.id}
                    dataKey={acc.email}
                    name={acc.email}
                    fill={COLORS[index % COLORS.length]}
                    radius={[4, 4, 0, 0]}
                  />
                );
              })}
            </BarChart>
          </ResponsiveContainer>
        </div>
      </CardContent>
    </Card>
  );
}
