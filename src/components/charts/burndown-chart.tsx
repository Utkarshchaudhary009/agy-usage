"use client";

import { useMemo } from "react";
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
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

interface BurndownChartProps {
  snapshots: QuotaSnapshotRecord[];
}

// Generate colors for different models
const COLORS = [
  "#2563eb", // blue-600
  "#dc2626", // red-600
  "#16a34a", // green-600
  "#d97706", // amber-600
  "#9333ea", // purple-600
  "#0891b2", // cyan-600
  "#ea580c", // orange-600
  "#4f46e5", // indigo-600
];

export function BurndownChart({ snapshots }: BurndownChartProps) {
  const { chartData, modelIds } = useMemo(() => {
    if (!snapshots || snapshots.length === 0) {
      return { chartData: [], modelIds: new Set<string>() };
    }

    const dataMap = new Map<string, Record<string, string | number>>();
    const mIds = new Set<string>();

    snapshots.forEach((snap) => {
      const timeKey = new Date(snap.timestamp).toLocaleString(undefined, {
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      });

      let entry = dataMap.get(timeKey);
      if (!entry) {
        entry = {
          timestamp: timeKey,
          rawDate: new Date(snap.timestamp).getTime(),
        };
        dataMap.set(timeKey, entry);
      }

      const snapshotData = snap.snapshot_data as SnapshotData;

      if (snapshotData?.models) {
        for (const model of snapshotData.models) {
          const key = model.modelId;
          mIds.add(key);

          if (entry[key] !== undefined) {
            const count = (entry[`${key}_count`] as number) || 1;
            const sum =
              (entry[`${key}_sum`] as number) || (entry[key] as number);

            entry[`${key}_count`] = count + 1;
            entry[`${key}_sum`] = sum + model.remainingPercentage;
            entry[key] = (sum + model.remainingPercentage) / (count + 1);
          } else {
            entry[key] = model.remainingPercentage;
          }
        }
      }
    });

    const cData = Array.from(dataMap.values()).sort(
      (a, b) => (a.rawDate as number) - (b.rawDate as number),
    );
    return { chartData: cData, modelIds: mIds };
  }, [snapshots]);

  if (!snapshots || snapshots.length === 0 || chartData.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Model Quota Burndown</CardTitle>
          <CardDescription>
            Remaining quota percentage over time
          </CardDescription>
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
        <CardTitle>Model Quota Burndown</CardTitle>
        <CardDescription>Remaining quota percentage over time</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="h-[300px] w-full">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart
              data={chartData}
              margin={{ top: 5, right: 30, left: 20, bottom: 5 }}
            >
              <CartesianGrid
                strokeDasharray="3 3"
                opacity={0.2}
                vertical={false}
              />
              <XAxis
                dataKey="timestamp"
                tick={{ fontSize: 12 }}
                tickMargin={10}
                minTickGap={30}
              />
              <YAxis
                tickFormatter={(value) => `${(value * 100).toFixed(0)}%`}
                domain={[0, 1]}
                tick={{ fontSize: 12 }}
              />
              <Tooltip
                // biome-ignore lint/suspicious/noExplicitAny: recharts tooltip formatter signature is complex
                formatter={(value: any) => [
                  `${(Number(value) * 100).toFixed(1)}%`,
                  undefined,
                ]}
                labelClassName="font-medium text-foreground"
                contentStyle={{
                  borderRadius: "6px",
                  border: "1px solid var(--border)",
                }}
              />
              <Legend wrapperStyle={{ fontSize: "12px", paddingTop: "10px" }} />
              {Array.from(modelIds).map((modelId, index) => (
                <Line
                  key={modelId}
                  type="monotone"
                  dataKey={modelId}
                  name={modelId.replace("claude-", "").replace("gemini-", "")}
                  stroke={COLORS[index % COLORS.length]}
                  strokeWidth={2}
                  dot={false}
                  activeDot={{ r: 6 }}
                />
              ))}
            </LineChart>
          </ResponsiveContainer>
        </div>
      </CardContent>
    </Card>
  );
}
