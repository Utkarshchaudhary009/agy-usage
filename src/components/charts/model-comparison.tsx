"use client";

import { useMemo } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
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
import type { QuotaSnapshotRecord, SnapshotData } from "@/lib/types/history";

interface ModelComparisonProps {
  snapshots: QuotaSnapshotRecord[];
}

export function ModelComparison({ snapshots }: ModelComparisonProps) {
  const chartData = useMemo(() => {
    if (!snapshots || snapshots.length === 0) return [];

    // Get the latest snapshot for each account
    const latestByAccount = new Map<string, QuotaSnapshotRecord>();
    snapshots.forEach((snap) => {
      const existing = latestByAccount.get(snap.account_id);
      if (
        !existing ||
        new Date(snap.timestamp).getTime() >
          new Date(existing.timestamp).getTime()
      ) {
        latestByAccount.set(snap.account_id, snap);
      }
    });

    // Aggregate model data across all latest snapshots
    const modelData = new Map<
      string,
      { modelId: string; provider: string; remainingSum: number; count: number }
    >();

    latestByAccount.forEach((snap) => {
      const snapshotData = snap.snapshot_data as SnapshotData;
      if (snapshotData?.models) {
        for (const model of snapshotData.models) {
          const existing = modelData.get(model.modelId) || {
            modelId: model.modelId,
            provider:
              model.modelProvider ||
              (model.modelId.includes("claude") ? "ANTHROPIC" : "GOOGLE"),
            remainingSum: 0,
            count: 0,
          };

          existing.remainingSum += model.remainingPercentage;
          existing.count += 1;

          modelData.set(model.modelId, existing);
        }
      }
    });

    return Array.from(modelData.values())
      .map((data) => ({
        name: data.modelId.replace("claude-", "").replace("gemini-", ""), // Short name
        fullId: data.modelId,
        percentage: (data.remainingSum / data.count) * 100,
        provider: data.provider,
      }))
      .sort((a, b) => b.percentage - a.percentage); // Sort highest to lowest
  }, [snapshots]);

  // Colors based on provider or percentage
  const getColor = (percentage: number, provider: string) => {
    if (percentage < 25) return "#dc2626"; // red
    if (percentage < 50) return "#ea580c"; // orange
    if (percentage < 75) return "#eab308"; // yellow

    // Green, but different shades for provider if >= 75%
    return provider === "ANTHROPIC" ? "#d97706" : "#2563eb";
  };

  if (!snapshots || snapshots.length === 0 || chartData.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Model Comparison</CardTitle>
          <CardDescription>Current remaining quota by model</CardDescription>
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
        <CardTitle>Current Quota by Model</CardTitle>
        <CardDescription>
          Average remaining across selected accounts
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="h-[300px] w-full">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart
              data={chartData}
              layout="vertical"
              margin={{ top: 5, right: 30, left: 50, bottom: 5 }}
            >
              <CartesianGrid
                strokeDasharray="3 3"
                opacity={0.2}
                horizontal={false}
              />
              <XAxis
                type="number"
                domain={[0, 100]}
                tickFormatter={(val) => `${val}%`}
                tick={{ fontSize: 12 }}
              />
              <YAxis
                dataKey="name"
                type="category"
                tick={{ fontSize: 12 }}
                width={100}
              />
              <Tooltip
                // biome-ignore lint/suspicious/noExplicitAny: recharts tooltip formatter signature is complex
                formatter={(value: any) => [
                  `${Number(value).toFixed(1)}%`,
                  "Remaining",
                ]}
                labelFormatter={(label, payload) =>
                  payload[0]?.payload.fullId || label
                }
                contentStyle={{
                  borderRadius: "6px",
                  border: "1px solid var(--border)",
                }}
              />
              <Bar dataKey="percentage" radius={[0, 4, 4, 0]}>
                {chartData.map((entry) => (
                  <Cell
                    key={entry.fullId}
                    fill={getColor(entry.percentage, entry.provider)}
                  />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </CardContent>
    </Card>
  );
}
