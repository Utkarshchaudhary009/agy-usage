"use client";

import { useId } from "react";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { WAKEUP_MODELS } from "@/lib/types/wakeup";
import { cn } from "@/lib/utils";

interface ModelSelectorProps {
  value: string[];
  onChange: (next: string[]) => void;
  error?: string;
}

export function ModelSelector({ value, onChange, error }: ModelSelectorProps) {
  const uid = useId();
  const errorId = `${uid}-error`;
  const selected = new Set(value);

  function toggle(modelId: string, checked: boolean) {
    const next = new Set(selected);
    if (checked) {
      next.add(modelId);
    } else {
      next.delete(modelId);
    }
    // Emit in declaration order so the payload does not depend on click order.
    onChange(WAKEUP_MODELS.filter((m) => next.has(m.id)).map((m) => m.id));
  }

  return (
    <div className="space-y-2">
      <Label id={`${uid}-label`}>Models to wake</Label>
      <fieldset
        className="grid gap-2 sm:grid-cols-2"
        aria-labelledby={`${uid}-label`}
        aria-describedby={error ? errorId : undefined}
      >
        {WAKEUP_MODELS.map((m) => {
          const checked = selected.has(m.id);
          const inputId = `${uid}-model-${m.id}`;
          return (
            <label
              key={m.id}
              htmlFor={inputId}
              className={cn(
                "flex cursor-pointer items-center gap-3 rounded-lg border p-3 transition-colors",
                checked
                  ? "border-primary/50 bg-primary/5"
                  : "border-border hover:bg-muted/50",
              )}
            >
              <Checkbox
                id={inputId}
                checked={checked}
                onCheckedChange={(c) => toggle(m.id, c === true)}
              />
              <div className="flex flex-col">
                <span className="text-sm font-medium">{m.label}</span>
                <span className="text-xs text-muted-foreground">
                  {m.provider}
                </span>
              </div>
            </label>
          );
        })}
      </fieldset>
      {error ? (
        <p id={errorId} className="text-xs text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}
