"use client";

import { WAKEUP_MODEL_OPTIONS } from "@/lib/types/wakeup";

interface ModelSelectorProps {
  selectedModels: string[];
  onChange: (models: string[]) => void;
  disabled?: boolean;
}

export function ModelSelector({
  selectedModels,
  onChange,
  disabled,
}: ModelSelectorProps) {
  function toggle(modelId: string, checked: boolean) {
    if (checked) {
      onChange([...selectedModels, modelId]);
    } else {
      onChange(selectedModels.filter((id) => id !== modelId));
    }
  }

  return (
    <div className="grid gap-2 sm:grid-cols-3">
      {WAKEUP_MODEL_OPTIONS.map((option) => {
        const checked = selectedModels.includes(option.id);
        return (
          <label
            key={option.id}
            className={`flex items-center gap-3 rounded-lg border p-3 text-sm transition-colors ${
              checked
                ? "border-primary bg-primary/5"
                : "border-input bg-background hover:bg-muted"
            } ${disabled ? "opacity-50" : "cursor-pointer"}`}
          >
            <input
              type="checkbox"
              className="size-4 rounded border-input accent-primary"
              checked={checked}
              disabled={disabled}
              onChange={(event) => toggle(option.id, event.target.checked)}
            />
            <span className="flex flex-col">
              <span className="font-medium">{option.label}</span>
              <span className="text-xs text-muted-foreground capitalize">
                {option.provider}
              </span>
            </span>
          </label>
        );
      })}
    </div>
  );
}
