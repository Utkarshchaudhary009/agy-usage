import "server-only";

import { createServiceClient } from "../../supabase/server";
import { inngest } from "../client";

/** Remaining-percentage at/above which a model counts as fully reset. */
const RESET_THRESHOLD = 0.999;
/** How many recent history rows to inspect while pairing consecutive snapshots. */
const HISTORY_SCAN_LIMIT = 200;

interface ResetDetection {
  clerkUserIds: string[];
}

/**
 * Compares an account's two most recent history rows per model and flags
 * models that jumped back to a full window (previously below threshold, now
 * at/above it). Users with wake_on_reset enabled on that account are fanned
 * out as wakeup/trigger.requested events; the atomic cooldown claim in
 * executeWakeup keeps overlapping resets from double-firing Google.
 */
export const detectQuotaReset = inngest.createFunction(
  {
    id: "detect-quota-reset",
    name: "Detect Quota Reset",
    retries: 2,
    triggers: [{ event: "quota/snapshot.saved" }],
  },
  async ({ event, step }) => {
    const accountId =
      typeof event.data?.accountId === "string" ? event.data.accountId : "";
    if (!accountId) {
      return { skipped: true, reason: "Missing accountId in event payload" };
    }

    const detection = await step.run(
      "compare-with-previous-snapshot",
      async () => {
        const supabase = createServiceClient();

        const { data, error } = await supabase
          .from("model_quota_history")
          .select(
            "model_id, remaining_percentage, is_exhausted, quota_snapshots!inner(timestamp)",
          )
          .eq("quota_snapshots.account_id", accountId)
          .order("quota_snapshots.timestamp", { ascending: false })
          .limit(HISTORY_SCAN_LIMIT);

        if (error) {
          throw new Error(`Failed to load quota history: ${error.message}`);
        }

        type Row = {
          model_id: string;
          remaining_percentage: number;
          is_exhausted: boolean | null;
        };
        const rows = (data ?? []) as unknown as Row[];

        // Rows arrive newest-first across all models; the first occurrence of a
        // model id is the current snapshot, the second is the previous one.
        const seen = new Map<string, Row>();
        const resetModels: string[] = [];
        for (const row of rows) {
          const known = seen.get(row.model_id);
          if (known === undefined) {
            seen.set(row.model_id, row);
            continue;
          }
          const wasBelow =
            Number(row.remaining_percentage) < RESET_THRESHOLD ||
            row.is_exhausted === true;
          const nowFull = Number(known.remaining_percentage) >= RESET_THRESHOLD;
          if (wasBelow && nowFull) {
            resetModels.push(row.model_id);
          }
          // Pair each model once; further occurrences are older history.
          seen.set(row.model_id, known);
        }
        return { resetModels: [...new Set(resetModels)] };
      },
    );

    if (detection.resetModels.length === 0) {
      return { resetsDetected: 0, notifiedUsers: 0 };
    }

    const targets = await step.run("find-wake-on-reset-users", async () => {
      const supabase = createServiceClient();

      // A config matches when it explicitly selects this account, or when its
      // selection is empty (= "all my accounts").
      const [specific, allAccounts] = await Promise.all([
        supabase
          .from("wakeup_configs")
          .select("clerk_user_id")
          .eq("enabled", true)
          .eq("wake_on_reset", true)
          .contains("selected_account_ids", [accountId]),
        supabase
          .from("wakeup_configs")
          .select("clerk_user_id")
          .eq("enabled", true)
          .eq("wake_on_reset", true)
          // Empty selection = "all my accounts"; PostgREST empty-array
          // literal via untyped filter (typed .eq rejects non-array values).
          .filter("selected_account_ids", "eq", "{}"),
      ]);

      if (specific.error || allAccounts.error) {
        throw new Error(
          `Failed to load wake-on-reset configs: ${specific.error?.message ?? allAccounts.error?.message}`,
        );
      }

      return [
        ...new Set(
          [...(specific.data ?? []), ...(allAccounts.data ?? [])].map(
            (row) => row.clerk_user_id,
          ),
        ),
      ];
    });

    if (targets.length > 0) {
      const BATCH_SIZE = 100;
      for (let i = 0; i < targets.length; i += BATCH_SIZE) {
        const batch = targets.slice(i, i + BATCH_SIZE).map((clerkUserId) => ({
          name: "wakeup/trigger.requested",
          data: { clerkUserId },
        }));
        await step.sendEvent(`dispatch-reset-wakeups-${i}`, batch);
      }
    }

    const result: ResetDetection & {
      resetsDetected: number;
      notifiedUsers: number;
    } = {
      clerkUserIds: targets,
      resetsDetected: detection.resetModels.length,
      notifiedUsers: targets.length,
    };
    return result;
  },
);
