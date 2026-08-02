import { fetchQuotaHandler, pollQuota } from "./poll-quota";

// Export all Inngest functions here to be registered in the API route
export const functions = [pollQuota, fetchQuotaHandler];
