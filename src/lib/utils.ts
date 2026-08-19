import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * Parses a numeric input string into an integer clamped to [min, max].
 * Returns `fallback` when the value is empty or not a finite number, so a
 * cleared number field never serializes as `0`/`NaN` (both of which fail
 * server-side validation).
 */
export function clampInt(
  raw: string,
  min: number,
  max: number,
  fallback: number,
): number {
  const trimmed = raw.trim();
  if (trimmed === "") return fallback;
  const value = Number(trimmed);
  if (!Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(value)));
}
