"use client";

import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { WAKEUP_MODELS } from "@/lib/wakeup/models";

interface ModelSelectorProps {
  selectedIds: string[];
  onToggle: (modelId: string) => void;
}

export function ModelSelector({ selectedIds, onToggle }: ModelSelectorProps) {
  return (
    <div className="grid gap-2 sm:grid-cols-2">
      {WAKEUP_MODELS.map((model) => {
        const checked = selectedIds.includes(model.id);
        return (
          <label
            key={model.id}
            className={cn(
              "flex cursor-pointer items-center gap-3 rounded-lg border p-3 transition-colors",
              checked
                ? "border-primary/40 bg-primary/5"
                : "border-border hover:bg-muted/50",
            )}
          >
            <input
              type="checkbox"
              checked={checked}
              onChange={() => onToggle(model.id)}
              className="size-4 accent-[var(--primary)]"
            />
            <span className="flex-1 text-sm font-medium">{model.label}</span>
            <Badge variant={checked ? "default" : "outline"}>
              {model.provider === "ANTHROPIC" ? "Claude" : "Gemini"}
            </Badge>
          </label>
        );
      })}
    </div>
  );
}
