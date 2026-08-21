import type * as React from "react";
import { useEffect, useState } from "react";

import { cn } from "@/lib/utils";

const INPUT_CLASS_NAME =
  "flex h-9 w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm ring-offset-background placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring disabled:cursor-not-allowed disabled:opacity-50";

function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(INPUT_CLASS_NAME, className)}
      {...props}
    />
  );
}

interface NumericInputProps
  extends Omit<React.ComponentProps<"input">, "value" | "onChange" | "type"> {
  value: number;
  onValueChange: (value: number) => void;
}

/**
 * Controlled number input that keeps an editable text draft so the field can be
 * cleared/typed into naturally. A bare `Number(event.target.value)` in an
 * `onChange` collapses an empty string to `0`, which both lies to the user and
 * blocks editing; here the numeric `value` only updates from a parseable entry,
 * and the draft re-syncs to the canonical value on external changes / blur.
 */
function NumericInput({
  value,
  onValueChange,
  className,
  ...props
}: NumericInputProps) {
  const [draft, setDraft] = useState(String(value));

  useEffect(() => {
    setDraft(String(value));
  }, [value]);

  return (
    <input
      type="number"
      data-slot="input"
      className={cn(INPUT_CLASS_NAME, className)}
      value={draft}
      onChange={(event) => {
        const raw = event.target.value;
        setDraft(raw);
        if (raw !== "") {
          const parsed = Number(raw);
          if (Number.isFinite(parsed)) onValueChange(parsed);
        }
      }}
      onBlur={() => setDraft(String(value))}
      {...props}
    />
  );
}

export { Input, NumericInput };
