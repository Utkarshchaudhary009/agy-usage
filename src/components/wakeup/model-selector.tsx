"use client";

import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { WAKEUP_MODELS } from "@/lib/types/wakeup";
import { cn } from "@/lib/utils";

interface ModelSelectorProps {
  selected: string[];
  onChange: (models: string[]) => void;
}

export function ModelSelector({ selected, onChange }: ModelSelectorProps) {
  function toggle(model: string, checked: boolean) {
    if (checked) {
      onChange(Array.from(new Set([...selected, model])));
    } else {
      onChange(selected.filter((m) => m !== model));
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <p className="text-sm text-muted-foreground">
        Models that will be kept warm by wakeup triggers.
      </p>
      <div className="grid gap-2 sm:grid-cols-2">
        {WAKEUP_MODELS.map((model) => {
          const checked = selected.includes(model);
          const id = `model-${model}`;
          return (
            <div
              key={model}
              className={cn(
                "flex items-center gap-3 rounded-lg border px-3 py-2 transition-colors",
                checked
                  ? "border-primary/50 bg-primary/5"
                  : "border-border bg-card",
              )}
            >
              <Checkbox
                id={id}
                checked={checked}
                onCheckedChange={(value) => toggle(model, value === true)}
              />
              <Label htmlFor={id} className="cursor-pointer font-mono text-xs">
                {model}
              </Label>
            </div>
          );
        })}
      </div>
    </div>
  );
}
