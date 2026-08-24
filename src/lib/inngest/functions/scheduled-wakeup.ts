import "server-only";
import { createServiceClient } from "@/lib/supabase/server";
import type { ScheduleInput } from "@/lib/wakeup/schedule-evaluator";
import { shouldTriggerNow } from "@/lib/wakeup/schedule-evaluator";
import { inngest } from "../client";

interface EnabledConfigRow {
  clerk_user_id: string;
  schedule_mode: string;
  interval_hours: number;
  daily_times: string[];
  cron_expression: string | null;
  last_run_started_at: string | null;
}

export const scheduledWakeup = inngest.createFunction(
  {
    id: "scheduled-wakeup",
    name: "Scheduled Wakeup Check",
    concurrency: { limit: 5 },
    triggers: [{ cron: "0 * * * *" }],
  },
  async ({ step }) => {
    const configs = await step.run("get-enabled-wakeup-configs", async () => {
      const supabase = createServiceClient();

      const allConfigs: EnabledConfigRow[] = [];
      let hasMore = true;
      let start = 0;
      const LIMIT = 1000;

      while (hasMore) {
        const { data, error } = await supabase
          .from("wakeup_configs")
          .select(
            "clerk_user_id, schedule_mode, interval_hours, daily_times, cron_expression, last_run_started_at",
          )
          .eq("enabled", true)
          .range(start, start + LIMIT - 1);

        if (error) {
          throw new Error(`Failed to fetch wakeup configs: ${error.message}`);
        }

        if (data && data.length > 0) {
          allConfigs.push(...data);
          start += LIMIT;
        } else {
          hasMore = false;
        }
      }

      return allConfigs;
    });

    const now = new Date();
    const events: { name: string; data: { clerkUserId: string } }[] = [];

    for (const config of configs) {
      const schedule: ScheduleInput = {
        scheduleMode: config.schedule_mode as ScheduleInput["scheduleMode"],
        intervalHours: config.interval_hours,
        dailyTimes: config.daily_times,
        cronExpression: config.cron_expression,
      };

      const lastTrigger = config.last_run_started_at
        ? new Date(config.last_run_started_at)
        : null;

      const shouldTrigger = shouldTriggerNow(schedule, lastTrigger, now);

      if (shouldTrigger) {
        events.push({
          name: "wakeup/trigger.requested",
          data: { clerkUserId: config.clerk_user_id },
        });
      }
    }

    if (events.length > 0) {
      const BATCH_SIZE = 50;
      for (let i = 0; i < events.length; i += BATCH_SIZE) {
        const batch = events.slice(i, i + BATCH_SIZE);
        await step.sendEvent(`dispatch-wakeup-triggers-batch-${i}`, batch);
      }
    }

    return { evaluated: configs.length, dispatched: events.length };
  },
);
