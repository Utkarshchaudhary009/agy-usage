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
      // Query all accounts with active tokens (where token_status is active and is_active is true)
      // Actually we probably want all linked accounts?
      // Wait, the implementation plan just says "Query all accounts with active tokens"
      const { data, error } = await supabase
        .from("google_accounts")
        .select("id")
        .eq("token_status", "active")
        .eq("is_active", true);

      if (error) {
        throw new Error(`Failed to fetch accounts: ${error.message}`);
      }

      return data ?? [];
    });

    // Fan out: Use coordinator pattern to emit events for parallel execution
    const events = accounts.map((account) => ({
      name: "quota/fetch.requested",
      data: { accountId: account.id },
    }));

    if (events.length > 0) {
      await step.sendEvent("dispatch-quota-fetches", events);
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
