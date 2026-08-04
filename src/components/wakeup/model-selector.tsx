"use client";

import { useCallback, useId } from "react";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { WAKEUP_MODELS } from "@/lib/types/wakeup";

interface ModelSelectorProps {
  selectedModels: string[];
  onChange: (selectedModels: string[]) => void;
  disabled?: boolean;
}

export function ModelSelector({
  selectedModels,
  onChange,
  disabled = false,
}: ModelSelectorProps) {
  const groupId = useId();

  const toggle = useCallback(
    (modelId: string, checked: boolean) => {
      if (checked) {
        if (selectedModels.includes(modelId)) return;
        onChange([...selectedModels, modelId]);
      } else {
        onChange(selectedModels.filter((id) => id !== modelId));
      }
    },
    [selectedModels, onChange],
  );

  return (
    <fieldset className="flex flex-col gap-3" disabled={disabled}>
      <legend className="sr-only">Models to keep awake</legend>
      {WAKEUP_MODELS.map((model) => {
        const inputId = `${groupId}-${model.id}`;
        return (
          <div key={model.id} className="flex items-center gap-3">
            <Checkbox
              id={inputId}
              checked={selectedModels.includes(model.id)}
              onCheckedChange={(checked) => toggle(model.id, checked === true)}
              disabled={disabled}
            />
            <Label htmlFor={inputId} className="font-normal">
              {model.label}
              {/* Decorative: the human label above already names the model. */}
              <span
                aria-hidden="true"
                className="font-mono text-xs text-muted-foreground"
              >
                {model.id}
              </span>
            </Label>
          </div>
        );
      })}
    </fieldset>
  );
}
