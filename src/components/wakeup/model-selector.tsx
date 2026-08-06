"use client";

import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { WAKEUP_MODELS } from "@/lib/types/wakeup";
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
  function toggle(id: string, checked: boolean) {
    if (checked) {
      onChange([...selected, id]);
    } else {
      onChange(selected.filter((m) => m !== id));
    }
  }

  const providers = Array.from(new Set(WAKEUP_MODELS.map((m) => m.provider)));

  return (
    <div className="flex flex-col gap-4">
      {providers.map((provider) => (
        <div key={provider} className="flex flex-col gap-2">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            {provider}
          </p>
          <div className="grid gap-2 sm:grid-cols-2">
            {WAKEUP_MODELS.filter((m) => m.provider === provider).map(
              (model) => {
                const checked = selected.includes(model.id);
                const inputId = `wakeup-model-${model.id}`;
                return (
                  <Label
                    key={model.id}
                    htmlFor={inputId}
                    className={cn(
                      "flex cursor-pointer items-center gap-2.5 rounded-lg border border-border bg-background px-3 py-2 text-sm font-normal transition-colors",
                      checked
                        ? "border-primary/50 bg-primary/5"
                        : "hover:bg-muted",
                      disabled && "pointer-events-none opacity-50",
                    )}
                  >
                    <Checkbox
                      id={inputId}
                      checked={checked}
                      onCheckedChange={(v) => toggle(model.id, v === true)}
                      disabled={disabled}
                    />
                    <span className="flex flex-col gap-0.5">
                      <span className="font-medium">{model.label}</span>
                      <span className="text-xs text-muted-foreground">
                        {model.id}
                      </span>
                    </span>
                  </Label>
                );
              },
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
