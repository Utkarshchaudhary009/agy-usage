"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";

export interface DateRangePickerProps {
  value?: { from: Date; to: Date };
  onChange: (range: { from: Date; to: Date }) => void;
}

export function DateRangePicker({ onChange }: DateRangePickerProps) {
  const [selectedPreset, setSelectedPreset] = useState<"24h" | "7d" | "30d">(
    "7d",
  );

  const setPreset = (preset: "24h" | "7d" | "30d") => {
    setSelectedPreset(preset);
    const to = new Date();
    let from = new Date();

    if (preset === "24h") {
      from = new Date(to.getTime() - 24 * 60 * 60 * 1000);
    } else if (preset === "7d") {
      from = new Date(to.getTime() - 7 * 24 * 60 * 60 * 1000);
    } else if (preset === "30d") {
      from = new Date(to.getTime() - 30 * 24 * 60 * 60 * 1000);
    }

    onChange({ from, to });
  };

  return (
    <div className="flex bg-muted/50 p-1 rounded-md">
      <Button
        variant={selectedPreset === "24h" ? "default" : "ghost"}
        size="sm"
        onClick={() => setPreset("24h")}
        className="text-xs h-7 px-2"
        aria-pressed={selectedPreset === "24h"}
      >
        24h
      </Button>
      <Button
        variant={selectedPreset === "7d" ? "default" : "ghost"}
        size="sm"
        onClick={() => setPreset("7d")}
        className="text-xs h-7 px-2"
        aria-pressed={selectedPreset === "7d"}
      >
        7d
      </Button>
      <Button
        variant={selectedPreset === "30d" ? "default" : "ghost"}
        size="sm"
        onClick={() => setPreset("30d")}
        className="text-xs h-7 px-2"
        aria-pressed={selectedPreset === "30d"}
      >
        30d
      </Button>
    </div>
  );
}
