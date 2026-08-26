"use client";

import { useEffect } from "react";
import { toast } from "sonner";
import { useRealtimeClient } from "@/components/providers/realtime-provider";
import { notifyWakeupComplete } from "@/lib/notifications";

/**
 * Subscribes to wakeup_logs inserts for the signed-in user and surfaces each
 * new trigger outcome as a browser notification + in-app toast. Works for
 * scheduled/background runs too — they write through the service role, which
 * realtime delivers to the owning user's channel.
 */
export function useRealtimeWakeup(enabled: boolean): void {
  const supabase = useRealtimeClient();

  useEffect(() => {
    if (!supabase || !enabled) return;

    const channel = supabase
      .channel("wakeup-log-updates")
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "wakeup_logs",
        },
        (payload) => {
          const row = payload.new as {
            model_id: string;
            success: boolean;
            error: string | null;
          };
          const title = row.success ? "Wakeup succeeded" : "Wakeup failed";
          const description = row.success
            ? `${row.model_id} responded.`
            : (row.error ?? `${row.model_id} did not respond.`);
          notifyWakeupComplete(title, description);
          toast[row.success ? "success" : "error"](title, { description });
        },
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [supabase, enabled]);
}
