"use client";

import { useMemo } from "react";
import {
  Area,
  AreaChart,
  CartesianGrid,
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

interface CreditsChartProps {
  snapshots: QuotaSnapshotRecord[];
}

export function CreditsChart({ snapshots }: CreditsChartProps) {
  const chartData = useMemo(() => {
    if (!snapshots || snapshots.length === 0) return [];

    const dataMap = new Map<string, Record<string, string | number>>();
    let hasCreditsData = false;

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

      if (snapshotData?.promptCredits) {
        hasCreditsData = true;
        const { available, monthly } = snapshotData.promptCredits;
        // If multiple accounts, sum them
        entry.available = ((entry.available as number) || 0) + available;
        entry.used = ((entry.used as number) || 0) + (monthly - available);
        entry.monthly = ((entry.monthly as number) || 0) + monthly;
      }
    });

    if (!hasCreditsData) return [];

    return Array.from(dataMap.values()).sort(
      (a, b) => (a.rawDate as number) - (b.rawDate as number),
    );
  }, [snapshots]);

  if (!snapshots || snapshots.length === 0 || chartData.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Prompt Credits</CardTitle>
          <CardDescription>Credit usage over time</CardDescription>
        </CardHeader>
        <CardContent className="h-[250px] flex items-center justify-center">
          <p className="text-muted-foreground">No data available</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Prompt Credits Usage</CardTitle>
        <CardDescription>Available vs used credits over time</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="h-[250px] w-full">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart
              data={chartData}
              margin={{ top: 5, right: 30, left: 20, bottom: 5 }}
            >
              <defs>
                <linearGradient id="colorAvailable" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#16a34a" stopOpacity={0.3} />
                  <stop offset="95%" stopColor="#16a34a" stopOpacity={0} />
                </linearGradient>
                <linearGradient id="colorUsed" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#dc2626" stopOpacity={0.3} />
                  <stop offset="95%" stopColor="#dc2626" stopOpacity={0} />
                </linearGradient>
              </defs>
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
              <YAxis tick={{ fontSize: 12 }} />
              <Tooltip
                labelClassName="font-medium text-foreground"
                contentStyle={{
                  borderRadius: "6px",
                  border: "1px solid var(--border)",
                }}
              />
              <Area
                type="monotone"
                dataKey="available"
                name="Available Credits"
                stroke="#16a34a"
                fillOpacity={1}
                fill="url(#colorAvailable)"
                stackId="1"
              />
              <Area
                type="monotone"
                dataKey="used"
                name="Used Credits"
                stroke="#dc2626"
                fillOpacity={1}
                fill="url(#colorUsed)"
                stackId="1"
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </CardContent>
    </Card>
  );
}
