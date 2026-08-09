"use client";

import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { WAKEUP_MODEL_OPTIONS } from "@/lib/types/wakeup";
import { cn } from "@/lib/utils";

interface ModelSelectorProps {
  value: string[];
  onChange: (models: string[]) => void;
}

export function ModelSelector({ value, onChange }: ModelSelectorProps) {
  const toggle = (id: string, checked: boolean) => {
    if (checked) {
      onChange([...value, id]);
    } else {
      onChange(value.filter((m) => m !== id));
    }
  };

  return (
    <div className="grid gap-2 sm:grid-cols-2">
      {WAKEUP_MODEL_OPTIONS.map((model) => {
        const checked = value.includes(model.id);
        return (
          <label
            key={model.id}
            htmlFor={`model-${model.id}`}
            className={cn(
              "flex cursor-pointer items-center gap-3 rounded-lg border p-3 transition-colors",
              checked
                ? "border-primary/50 bg-primary/5"
                : "border-border bg-background hover:bg-muted/50",
            )}
          >
            <Checkbox
              id={`model-${model.id}`}
              checked={checked}
              onCheckedChange={(c) => toggle(model.id, c === true)}
              aria-label={`Select ${model.label}`}
            />
            <div className="flex flex-col">
              <Label className="cursor-pointer font-normal">
                {model.label}
              </Label>
              <span
                className={cn(
                  "text-xs font-medium",
                  model.provider === "ANTHROPIC"
                    ? "text-orange-600 dark:text-orange-400"
                    : "text-blue-600 dark:text-blue-400",
                )}
              >
                {model.provider === "ANTHROPIC" ? "Claude" : "Gemini"}
              </span>
            </div>
          </label>
        );
      })}
    </div>
  );
}
