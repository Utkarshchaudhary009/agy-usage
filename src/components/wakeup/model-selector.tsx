"use client";

import { Check } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  getWakeupModelLabel,
  getWakeupModelProviderLabel,
  WAKEUP_MODELS,
} from "@/lib/wakeup/models";

interface ModelSelectorProps {
  value: string[];
  onChange: (models: string[]) => void;
}

export function ModelSelector({ value, onChange }: ModelSelectorProps) {
  const toggle = (id: string) => {
    if (value.includes(id)) {
      onChange(value.filter((m) => m !== id));
    } else {
      onChange([...value, id]);
    }
  };

  return (
    <div className="grid gap-2 sm:grid-cols-3">
      {WAKEUP_MODELS.map((model) => {
        const active = value.includes(model.id);
        return (
          <label
            key={model.id}
            className={cn(
              "flex cursor-pointer items-center justify-between gap-2 rounded-lg border px-3 py-2.5 text-left text-sm transition-colors",
              "focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-2 focus-within:ring-offset-background",
              active
                ? "border-primary bg-primary/5 ring-1 ring-primary/40"
                : "border-border bg-background hover:bg-muted",
            )}
          >
            <span className="flex flex-col">
              <span className="font-medium">
                {getWakeupModelLabel(model.id)}
              </span>
              <span className="text-xs text-muted-foreground">
                {getWakeupModelProviderLabel(model.provider)}
              </span>
            </span>
            <span
              className={cn(
                "flex size-4 items-center justify-center rounded border",
                active
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-muted-foreground/40",
              )}
            >
              {active && <Check className="size-3" />}
            </span>
            <input
              type="checkbox"
              className="sr-only"
              checked={active}
              aria-label={getWakeupModelLabel(model.id)}
              onChange={() => toggle(model.id)}
            />
          </label>
        );
      })}
    </div>
  );
}
