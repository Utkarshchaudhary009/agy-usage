"use client";

import { Loader2, Zap } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import type { TriggerAllResult } from "@/lib/types/wakeup";

interface TriggerButtonProps {
  /** Runs a targeted single-account/model trigger instead of the full config. */
  target?: { accountId: string; modelId: string };
  size?: "sm" | "default";
  label?: string;
  disabled?: boolean;
  /** Called after a run completes (success, skip, or failure) so parents can refresh. */
  onTriggered?: () => void;
}

// POST /api/wakeup/trigger runs accounts × models sequentially and may take up
// to its 60s serverless budget; give the client headroom above that.
const REQUEST_TIMEOUT_MS = 90_000;

export function TriggerButton({
  target,
  size = "default",
  label,
  disabled,
  onTriggered,
}: TriggerButtonProps) {
  const [isRunning, setIsRunning] = useState(false);

  const trigger = async () => {
    setIsRunning(true);
    try {
      const res = await fetch("/api/wakeup/trigger", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(target ?? {}),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      const json = (await res.json().catch(() => ({}))) as {
        results?: { success: boolean; modelId: string; error?: string }[];
        skipped?: boolean;
        skipReason?: string;
        message?: string;
        error?: string;
      };

      let completed: TriggerAllResult | null = null;
      if (!res.ok) {
        toast.error(json.message || json.error || "Wakeup trigger failed.");
      } else if (json.skipped) {
        toast.warning(json.skipReason || "Wakeup skipped.");
        completed = json as unknown as TriggerAllResult;
      } else {
        const results = json.results ?? [];
        const succeeded = results.filter((r) => r.success).length;
        if (results.length === 0) {
          toast.info("Nothing to trigger — link an account first.");
        } else if (succeeded === results.length) {
          toast.success(`Wakeup complete — ${succeeded} model(s) responded.`);
        } else {
          toast.warning(`${succeeded}/${results.length} models responded.`);
          for (const failure of results.filter((r) => !r.success).slice(0, 3)) {
            toast.error(failure.modelId, { description: failure.error });
          }
        }
        completed = json as unknown as TriggerAllResult;
      }
      // Only a completed HTTP response proves the log rows are final; timeout
      // and network failures may still be mid-write server-side.
      if (completed) onTriggered?.();
    } catch (err) {
      // TimeoutError means the server is still working; AbortError means this
      // component unmounted. Both differ from a genuine network failure.
      if (err instanceof Error && err.name === "AbortError") return;
      toast.error(
        err instanceof Error && err.name === "TimeoutError"
          ? "Wakeup timed out — check history for partial results."
          : "Network error while triggering wakeup.",
      );
    } finally {
      setIsRunning(false);
    }
  };

  return (
    <Button
      type="button"
      size={size}
      onClick={() => void trigger()}
      disabled={disabled || isRunning}
    >
      {isRunning ? (
        <Loader2 className="animate-spin" aria-hidden />
      ) : (
        <Zap aria-hidden />
      )}
      {label ?? (isRunning ? "Waking models…" : "Trigger now")}
      <span className="sr-only" aria-live="polite">
        {isRunning ? "Wakeup running" : ""}
      </span>
    </Button>
  );
}
