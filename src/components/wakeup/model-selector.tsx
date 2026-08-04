"use client";

import { Check } from "lucide-react";
import { cn } from "@/lib/utils";

const AVAILABLE_MODELS = [
  {
    id: "claude-sonnet-4-5",
    label: "Claude Sonnet 4.5",
    provider: "Anthropic",
  },
  { id: "gemini-3-flash", label: "Gemini 3 Flash", provider: "Google" },
  { id: "gemini-3-pro-low", label: "Gemini 3 Pro Low", provider: "Google" },
];

interface ModelSelectorProps {
  selectedModels: string[];
  onToggleModel: (model: string) => void;
}

export function ModelSelector({
  selectedModels,
  onToggleModel,
}: ModelSelectorProps) {
  return (
    <div className="flex flex-col gap-3">
      <h2 className="text-base font-semibold">Models</h2>
      <div className="grid gap-2 sm:grid-cols-3">
        {AVAILABLE_MODELS.map((model) => {
          const isSelected = selectedModels.includes(model.id);
          return (
            <button
              key={model.id}
              type="button"
              aria-pressed={isSelected}
              onClick={() => onToggleModel(model.id)}
              className={cn(
                "flex items-center gap-3 rounded-lg border px-4 py-3 text-left transition-colors",
                isSelected
                  ? "border-primary bg-primary/5 ring-1 ring-primary"
                  : "border-border bg-card hover:bg-muted/50",
              )}
            >
              <span
                className={cn(
                  "flex h-5 w-5 items-center justify-center rounded border text-xs",
                  isSelected
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-muted-foreground/30",
                )}
              >
                {isSelected && <Check className="h-3 w-3" />}
              </span>
              <div className="flex flex-col gap-0.5">
                <span className="text-sm font-medium">{model.label}</span>
                <span className="text-xs text-muted-foreground">
                  {model.provider}
                </span>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
