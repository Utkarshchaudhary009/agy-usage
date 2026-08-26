import { detectQuotaReset } from "./detect-reset";
import { executeWakeupHandler } from "./execute-wakeup";
import { fetchQuotaHandler, pollQuota } from "./poll-quota";
import { scheduledWakeup } from "./scheduled-wakeup";

// Export all Inngest functions here to be registered in the API route.
// For local development run the Inngest Dev Server alongside `bun dev`:
//   npx inngest-cli dev
export const functions = [
  pollQuota,
  fetchQuotaHandler,
  scheduledWakeup,
  executeWakeupHandler,
  detectQuotaReset,
];
