"use client";

import { Check } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { WAKEUP_MODELS, type WakeupModelOption } from "@/lib/types/wakeup";
import { cn } from "@/lib/utils";

interface ModelSelectorProps {
  value: string[];
  onChange: (next: string[]) => void;
  options?: WakeupModelOption[];
}

export function ModelSelector({
  value,
  onChange,
  options = WAKEUP_MODELS,
}: ModelSelectorProps) {
  const selected = new Set(value);

  const toggle = (id: string, checked: boolean) => {
    const next = new Set(selected);
    if (checked) next.add(id);
    else next.delete(id);
    onChange(options.filter((o) => next.has(o.id)).map((o) => o.id));
  };

  return (
    <div className="grid gap-2 sm:grid-cols-2">
      {options.map((model) => {
        const checked = selected.has(model.id);
        const providerLabel =
          model.provider === "ANTHROPIC" ? "Claude" : "Gemini";
        const checkboxId = `model-${model.id}`;
        return (
          <div
            key={model.id}
            className={cn(
              "flex items-center gap-3 rounded-lg border p-3 transition-colors",
              checked
                ? "border-primary/50 bg-primary/5"
                : "border-border bg-background hover:bg-muted/50",
            )}
          >
            <Checkbox
              id={checkboxId}
              checked={checked}
              onCheckedChange={(c) => toggle(model.id, c === true)}
            />
            <Label
              htmlFor={checkboxId}
              className="flex flex-1 cursor-pointer flex-col"
            >
              <span>{model.label}</span>
              <span className="text-xs font-normal text-muted-foreground">
                {providerLabel} · {model.id}
              </span>
            </Label>
            {checked && <Check className="size-4 text-primary" aria-hidden />}
          </div>
        );
      })}
    </div>
  );
}
