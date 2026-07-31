"use client";

import { clsx } from "clsx";
import { Clock } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import type { ModelQuotaInfo } from "@/lib/types/quota";
import { CountdownTimer } from "./countdown-timer";

interface ModelCardProps {
  model: ModelQuotaInfo;
  onRefresh?: () => void;
}

export function ModelCard({ model, onRefresh }: ModelCardProps) {
  const percentage = Math.round(model.remainingPercentage * 100);

  const getColorClass = (percent: number, isExhausted: boolean) => {
    if (isExhausted || percent <= 0) return "bg-gray-500";
    if (percent >= 75) return "bg-emerald-500";
    if (percent >= 50) return "bg-yellow-500";
    if (percent >= 25) return "bg-orange-500";
    return "bg-red-500";
  };

  const getTextColorClass = (percent: number, isExhausted: boolean) => {
    if (isExhausted || percent <= 0) return "text-gray-500";
    if (percent >= 75) return "text-emerald-500";
    if (percent >= 50) return "text-yellow-600 dark:text-yellow-500";
    if (percent >= 25) return "text-orange-500";
    return "text-red-500";
  };

  const colorClass = getColorClass(percentage, model.isExhausted);
  const textColorClass = getTextColorClass(percentage, model.isExhausted);

  const provider =
    model.modelProvider === "ANTHROPIC"
      ? "Claude"
      : model.modelProvider === "GOOGLE"
        ? "Gemini"
        : model.modelProvider || "Model";

  return (
    <Card className={clsx("flex flex-col", model.isExhausted && "opacity-75")}>
      <CardHeader className="pb-3 flex flex-row justify-between items-start space-y-0">
        <div className="space-y-1">
          <CardTitle className="text-base font-medium line-clamp-1">
            {model.displayName}
          </CardTitle>
          <div className="flex gap-2 items-center text-xs text-muted-foreground">
            <Badge variant="outline" className="text-[10px] px-1.5 py-0">
              {provider}
            </Badge>
            {model.isAutocompleteOnly && (
              <Badge variant="secondary" className="text-[10px] px-1.5 py-0">
                Autocomplete
              </Badge>
            )}
          </div>
        </div>
        {model.isExhausted && (
          <Badge variant="destructive" className="ml-2">
            Exhausted
          </Badge>
        )}
      </CardHeader>

      <CardContent className="pb-3 flex-1 flex flex-col justify-center">
        <div className="flex justify-between items-end mb-2">
          <span className="text-sm font-medium">Remaining</span>
          <span className={clsx("text-2xl font-bold", textColorClass)}>
            {percentage}%
          </span>
        </div>
        <Progress
          value={percentage}
          className="h-3 w-full bg-secondary"
          indicatorClassName={colorClass}
        />
      </CardContent>

      <CardFooter className="pt-0 text-xs text-muted-foreground flex items-center gap-1.5">
        <Clock className="h-3 w-3" />
        <span>Resets in: </span>
        {model.resetTime ? (
          <CountdownTimer resetTime={model.resetTime} onReset={onRefresh} />
        ) : (
          <span>Unknown</span>
        )}
      </CardFooter>
    </Card>
  );
}
