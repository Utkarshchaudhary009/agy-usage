import { executeWakeupHandler } from "./execute-wakeup";
import { fetchQuotaHandler, pollQuota } from "./poll-quota";
import { scheduledWakeup } from "./scheduled-wakeup";

// Export all Inngest functions here to be registered in the API route
export const functions = [
  pollQuota,
  fetchQuotaHandler,
  scheduledWakeup,
  executeWakeupHandler,
];
