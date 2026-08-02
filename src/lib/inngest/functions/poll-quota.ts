import { saveSnapshot } from "../../quota/history";
import { fetchQuotaForAccount } from "../../quota/service";
import { createServiceClient } from "../../supabase/server";
import { inngest } from "../client";

export const pollQuota = inngest.createFunction(
  {
    id: "poll-quota-all-users",
    name: "Poll Quota for All Users",
    triggers: [{ cron: "*/30 * * * *" }],
  },
  async ({ step }) => {
    const accounts = await step.run("get-all-active-accounts", async () => {
      const supabase = createServiceClient();

      const allAccounts: { id: string }[] = [];
      let hasMore = true;
      let start = 0;
      const LIMIT = 1000;

      while (hasMore) {
        const { data, error } = await supabase
          .from("google_accounts")
          .select("id")
          .eq("token_status", "active")
          .eq("is_active", true)
          .range(start, start + LIMIT - 1);

        if (error) {
          throw new Error(`Failed to fetch accounts: ${error.message}`);
        }

        if (data && data.length > 0) {
          allAccounts.push(...data);
          start += LIMIT;
        } else {
          hasMore = false;
        }
      }

      return allAccounts;
    });

    // Fan out: Use coordinator pattern to emit events for parallel execution
    const events = accounts.map((account) => ({
      name: "quota/fetch.requested",
      data: { accountId: account.id },
    }));

    if (events.length > 0) {
      // Chunk events into batches of 100 to avoid overloading Inngest
      const BATCH_SIZE = 100;
      for (let i = 0; i < events.length; i += BATCH_SIZE) {
        const batch = events.slice(i, i + BATCH_SIZE);
        await step.sendEvent(`dispatch-quota-fetches-batch-${i}`, batch);
      }
    }

    return { dispatched: events.length };
  },
);

export const fetchQuotaHandler = inngest.createFunction(
  {
    id: "fetch-account-quota",
    name: "Fetch Quota for Account",
    retries: 3,
    triggers: [{ event: "quota/fetch.requested" }],
  },
  async ({ event, step }) => {
    const { accountId } = event.data;
    const snapshot = await step.run("fetch-api", () =>
      fetchQuotaForAccount(accountId, { asBackgroundJob: true }),
    );
    await step.run("save-db", () =>
      saveSnapshot(accountId, snapshot, { asBackgroundJob: true }),
    );

    return { success: true, accountId };
  },
);
