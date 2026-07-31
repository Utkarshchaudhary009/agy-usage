"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import type { ModelQuotaInfo } from "@/lib/types/quota";
import { ModelCard } from "./model-card";

interface QuotaGridProps {
  models: ModelQuotaInfo[];
  onRefresh?: () => void;
}

type FilterType = "ALL" | "CLAUDE" | "GEMINI";

export function QuotaGrid({ models, onRefresh }: QuotaGridProps) {
  const [filter, setFilter] = useState<FilterType>("ALL");
  const [showAutocomplete, setShowAutocomplete] = useState(false);

  const filteredModels = models.filter((model) => {
    // Filter by provider
    if (filter === "CLAUDE" && model.modelProvider !== "ANTHROPIC")
      return false;
    if (filter === "GEMINI" && model.modelProvider !== "GOOGLE") return false;

    // Filter by autocomplete
    if (!showAutocomplete && model.isAutocompleteOnly) return false;

    return true;
  });

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div className="flex gap-2 bg-muted p-1 rounded-lg">
          <Button
            variant={filter === "ALL" ? "default" : "ghost"}
            size="sm"
            onClick={() => setFilter("ALL")}
            className="h-7 text-xs"
          >
            All Models
          </Button>
          <Button
            variant={filter === "CLAUDE" ? "default" : "ghost"}
            size="sm"
            onClick={() => setFilter("CLAUDE")}
            className="h-7 text-xs"
          >
            Claude
          </Button>
          <Button
            variant={filter === "GEMINI" ? "default" : "ghost"}
            size="sm"
            onClick={() => setFilter("GEMINI")}
            className="h-7 text-xs"
          >
            Gemini
          </Button>
        </div>

        <Button
          variant="outline"
          size="sm"
          onClick={() => setShowAutocomplete(!showAutocomplete)}
          className="h-8 text-xs"
        >
          {showAutocomplete ? "Hide" : "Show"} Autocomplete
        </Button>
      </div>

      {filteredModels.length === 0 ? (
        <div className="text-center p-8 border rounded-lg bg-muted/20 text-muted-foreground">
          No models found matching the current filters.
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {filteredModels.map((model) => (
            <ModelCard
              key={model.modelId}
              model={model}
              onRefresh={onRefresh}
            />
          ))}
        </div>
      )}
    </div>
  );
}
