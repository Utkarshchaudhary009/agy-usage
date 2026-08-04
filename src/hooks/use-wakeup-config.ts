"use client";

import { useRouter } from "next/navigation";
import { useCallback, useState } from "react";
import { toast } from "sonner";
import type { WakeupConfig, WakeupConfigInput } from "@/lib/types/wakeup";

interface UseWakeupConfigResult {
  isSaving: boolean;
  /** Returns the persisted config, or null when the save failed. */
  save: (input: WakeupConfigInput) => Promise<WakeupConfig | null>;
}

const REQUEST_TIMEOUT_MS = 15_000;

export function useWakeupConfig(): UseWakeupConfigResult {
  const router = useRouter();
  const [isSaving, setIsSaving] = useState(false);

  const save = useCallback(
    async (input: WakeupConfigInput): Promise<WakeupConfig | null> => {
      setIsSaving(true);
      try {
        const res = await fetch("/api/wakeup/config", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(input),
          // Bound the request so a stalled server cannot hang the UI.
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        });

        const json = (await res.json().catch(() => ({}))) as {
          config?: WakeupConfig;
          message?: string;
          error?: string;
        };

        if (!res.ok || !json.config) {
          toast.error(json.message || json.error || "Failed to save settings");
          return null;
        }

        toast.success("Wakeup settings saved");
        // The form already applies the authoritative response; this only keeps
        // the router's RSC cache from serving a stale config on a later visit.
        router.refresh();
        return json.config;
      } catch (err) {
        // DOMException (AbortError/TimeoutError) is not guaranteed to satisfy
        // `instanceof Error` in every browser, so inspect the name directly.
        const errName =
          typeof err === "object" && err !== null && "name" in err
            ? String((err as { name: unknown }).name)
            : undefined;

        if (errName === "AbortError" || errName === "TimeoutError") {
          toast.error("Saving timed out. Please try again.");
        } else {
          toast.error(
            err instanceof Error ? err.message : "Unexpected error occurred",
          );
        }
        return null;
      } finally {
        setIsSaving(false);
      }
    },
    [router],
  );

  return { isSaving, save };
}
