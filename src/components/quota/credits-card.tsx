"use client";

import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import type { PromptCreditsInfo } from "@/lib/types/quota";

interface CreditsCardProps {
  credits: PromptCreditsInfo;
  planType?: string;
}

export function CreditsCard({ credits, planType }: CreditsCardProps) {
  const remaining = credits.remainingPercentage * 100;

  return (
    <Card>
      <CardHeader className="pb-3 flex flex-row items-center justify-between">
        <div className="space-y-1">
          <CardTitle className="text-base font-medium">
            Prompt Credits
          </CardTitle>
          <CardDescription>Monthly allocation for AI features</CardDescription>
        </div>
        {planType && (
          <Badge variant="secondary" className="capitalize">
            {planType.toLowerCase()} Plan
          </Badge>
        )}
      </CardHeader>
      <CardContent>
        <div className="flex justify-between items-end mb-2">
          <span className="text-sm font-medium">Available</span>
          <div className="text-right">
            <span className="text-2xl font-bold">{credits.available}</span>
            <span className="text-sm text-muted-foreground">
              {" "}
              / {credits.monthly}
            </span>
          </div>
        </div>
        <Progress
          value={remaining}
          className="h-3 w-full"
          indicatorClassName={
            remaining <= 10
              ? "bg-red-500"
              : remaining <= 25
                ? "bg-orange-500"
                : "bg-primary"
          }
        />
        <p className="text-xs text-muted-foreground mt-3 text-right">
          {remaining.toFixed(1)}% remaining
        </p>
      </CardContent>
    </Card>
  );
}
