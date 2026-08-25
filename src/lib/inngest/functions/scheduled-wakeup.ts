import { createServiceClient } from "../../supabase/server";
import { shouldTriggerNow } from "../../wakeup/schedule-evaluator";
import { inngest } from "../client";

// Fan-out batch size: matches the poll-quota coordinator pattern so a growing
// user base never produces one oversized Inngest API call.
const DISPATCH_BATCH_SIZE = 100;

// PostgREST caps a single response (default ~1000 rows); page through so an
// enabled config can never be silently dropped from scheduling.
const CONFIG_PAGE_SIZE = 500;

export const scheduledWakeup = inngest.createFunction(
  {
    id: "scheduled-wakeup",
    name: "Scheduled Wakeup Check",
    concurrency: { limit: 5 },
    triggers: [{ cron: "0 * * * *" }],
  },
  async ({ step }) => {
    // One step evaluates every schedule against a single shared instant: pure
    // computation needs no per-item failure isolation, and one-step-per-user
    // would collide with Inngest's per-run step cap as the user base grows.
    const dueUserIds = await step.run("evaluate-schedules", async () => {
      const supabase = createServiceClient();
      const now = new Date();
      const due: string[] = [];
      let from = 0;

      for (;;) {
        const { data, error } = await supabase
          .from("wakeup_configs")
          .select(
            "clerk_user_id, enabled, schedule_mode, interval_hours, daily_times, cron_expression, last_run_started_at",
          )
          .eq("enabled", true)
          .range(from, from + CONFIG_PAGE_SIZE - 1);

        if (error) {
          throw new Error(`Failed to load wakeup configs: ${error.message}`);
        }

        for (const row of data ?? []) {
          if (
            shouldTriggerNow(
              {
                enabled: row.enabled,
                scheduleMode: row.schedule_mode,
                intervalHours: row.interval_hours,
                dailyTimes: row.daily_times ?? [],
                cronExpression: row.cron_expression,
              },
              row.last_run_started_at,
              now,
            )
          ) {
            due.push(row.clerk_user_id);
          }
        }

        if ((data ?? []).length < CONFIG_PAGE_SIZE) break;
        from += CONFIG_PAGE_SIZE;
      }

      return due;
    });

    for (let i = 0; i < dueUserIds.length; i += DISPATCH_BATCH_SIZE) {
      const batch = dueUserIds
        .slice(i, i + DISPATCH_BATCH_SIZE)
        .map((clerkUserId) => ({
          name: "wakeup/trigger.requested",
          data: { clerkUserId },
        }));
      await step.sendEvent(`dispatch-wakeup-batch-${i}`, batch);
    }

    return { dispatched: dueUserIds.length };
  },
);
