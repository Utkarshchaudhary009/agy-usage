"use client";

import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { WAKEUP_MODELS } from "@/lib/types/wakeup";
import { cn } from "@/lib/utils";

export function ModelSelector({
  value,
  onChange,
  error,
}: {
  value: string[];
  onChange: (next: string[]) => void;
  error?: string;
}) {
  function toggle(modelId: string, checked: boolean) {
    if (checked) {
      onChange([...value, modelId]);
    } else {
      onChange(value.filter((m) => m !== modelId));
    }
  }

  return (
    <div className="space-y-2">
      <Label>Models to wake</Label>
      <div className="grid gap-2 sm:grid-cols-2">
        {WAKEUP_MODELS.map((m) => {
          const checked = value.includes(m.id);
          const inputId = `wakeup-model-${m.id}`;
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
      </div>
      {error ? <p className="text-xs text-destructive">{error}</p> : null}
    </div>
  );
}
