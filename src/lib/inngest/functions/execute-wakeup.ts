import "server-only";

import { isOnCooldown } from "../../wakeup/cooldown";
import { executeWakeup } from "../../wakeup/trigger-service";
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
    const clerkUserId =
      typeof event.data?.clerkUserId === "string" ? event.data.clerkUserId : "";
    if (!clerkUserId) {
      return { skipped: true, reason: "Missing clerkUserId in event payload" };
    }

    // Cheap pre-check before the real work; the authoritative duplicate guard
    // is the atomic claim_wakeup_run() inside executeWakeup, which serializes
    // concurrent manual/scheduled runs on the user's config row.
    const onCooldown = await step.run("check-cooldown", () =>
      isOnCooldown(clerkUserId, { asBackgroundJob: true }),
    );
    if (onCooldown) {
      return { skipped: true, reason: "On cooldown" };
    }

    // Known limitation on retries: if the run fails partway through (some
    // accounts already triggered), the cooldown claim from the failed attempt
    // stays stamped, so an Inngest retry observes "On cooldown" and skips
    // instead of resuming. The remainder runs at the next scheduled tick; the
    // atomic claim guarantees neither attempt can double-fire an account.
    return step.run("execute", () =>
      executeWakeup(clerkUserId, { asBackgroundJob: true }),
    );
  },
);
