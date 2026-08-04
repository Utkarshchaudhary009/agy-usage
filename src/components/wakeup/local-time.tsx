"use client";

import { useEffect, useMemo, useState } from "react";
import { formatUtcDateTime } from "@/lib/wakeup/format";

interface LocalTimeProps {
  /** ISO string or Date. */
  value: string | Date;
  className?: string;
}

/**
 * Renders a timestamp in the visitor's locale/timezone.
 *
 * Server and first client render both emit the deterministic UTC form; the
 * localised form is swapped in after mount so hydration can never mismatch.
 */
export function LocalTime({ value, className }: LocalTimeProps) {
  const date = useMemo(
    () => (value instanceof Date ? value : new Date(value)),
    [value],
  );

  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  if (Number.isNaN(date.getTime())) return null;

  return (
    <time dateTime={date.toISOString()} className={className}>
      {mounted
        ? date.toLocaleString(undefined, {
            dateStyle: "medium",
            timeStyle: "short",
          })
        : formatUtcDateTime(date)}
    </time>
  );
}
