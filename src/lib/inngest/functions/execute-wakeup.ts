import "server-only";
import { executeWakeup } from "@/lib/wakeup/trigger-service";
import { inngest } from "../client";

export const executeWakeupHandler = inngest.createFunction(
  {
    id: "execute-wakeup",
    name: "Execute Wakeup for User",
    retries: 2,
    concurrency: { limit: 10 },
    triggers: [{ event: "wakeup/trigger.requested" }],
  },
  async ({ event, step }) => {
    const { clerkUserId } = event.data;

    const result = await step.run("execute-wakeup", () =>
      executeWakeup(clerkUserId, { asBackgroundJob: true }),
    );

    return result;
  },
);
