"use client";

import { Slider as SliderPrimitive } from "radix-ui";
import type * as React from "react";

import { cn } from "@/lib/utils";

function Slider({
  className,
  defaultValue,
  value,
  min = 0,
  max = 100,
  thumbLabel,
  thumbLabelledBy,
  ...props
}: React.ComponentProps<typeof SliderPrimitive.Root> & {
  /** Accessible name for the thumb (Root renders a span, so it cannot hold one). */
  thumbLabel?: string;
  /** Id of an element naming the thumb. */
  thumbLabelledBy?: string;
}) {
  // Radix renders one thumb per value.
  const thumbValues = Array.isArray(value)
    ? value
    : Array.isArray(defaultValue)
      ? defaultValue
      : [min];

  return (
    <SliderPrimitive.Root
      data-slot="slider"
      defaultValue={defaultValue}
      value={value}
      min={min}
      max={max}
      className={cn(
        "relative flex w-full touch-none items-center select-none data-[disabled]:opacity-50",
        className,
      )}
      {...props}
    >
      <SliderPrimitive.Track
        data-slot="slider-track"
        className="relative h-1.5 w-full grow overflow-hidden rounded-full bg-muted"
      >
        <SliderPrimitive.Range
          data-slot="slider-range"
          className="absolute h-full bg-primary"
        />
      </SliderPrimitive.Track>
      {thumbValues.map((_, index) => (
        <SliderPrimitive.Thumb
          // Thumb positions are index-identified; the list length is fixed by
          // the value arity, so the index is a stable key here.
          // biome-ignore lint/suspicious/noArrayIndexKey: thumbs have no other stable identity
          key={index}
          data-slot="slider-thumb"
          aria-label={thumbLabel}
          aria-labelledby={thumbLabelledBy}
          className="block size-4 shrink-0 rounded-full border border-primary/50 bg-background shadow-sm transition-[color,box-shadow] hover:ring-3 hover:ring-ring/40 focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none disabled:pointer-events-none"
        />
      ))}
    </SliderPrimitive.Root>
  );
}

export { Slider };
