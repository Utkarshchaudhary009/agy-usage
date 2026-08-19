"use client";

import { AVAILABLE_WAKEUP_MODELS } from "@/lib/types/wakeup";
import { cn } from "@/lib/utils";

interface ModelSelectorProps {
  selected: string[];
  onChange: (models: string[]) => void;
  disabled?: boolean;
}

export function ModelSelector({
  selected,
  onChange,
  disabled,
}: ModelSelectorProps) {
  const toggle = (id: string) => {
    if (selected.includes(id)) {
      onChange(selected.filter((m) => m !== id));
    } else {
      onChange([...selected, id]);
    }
  };

  return (
    <div className="grid gap-2 sm:grid-cols-2">
      {AVAILABLE_WAKEUP_MODELS.map((model) => {
        const checked = selected.includes(model.id);
        return (
          <label
            key={model.id}
            className={cn(
              "flex cursor-pointer items-center gap-3 rounded-lg border p-3 text-sm transition-colors",
              checked
                ? "border-primary bg-primary/5"
                : "border-border hover:bg-muted",
              disabled && "pointer-events-none opacity-50",
            )}
          >
            <input
              type="checkbox"
              className="size-4 rounded border-input accent-primary"
              checked={checked}
              onChange={() => toggle(model.id)}
            />
            <span className="font-medium">{model.label}</span>
          </label>
        );
      })}
    </div>
  );
}
