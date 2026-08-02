import type { Database } from "./database";

export type QuotaSnapshotRecord =
  Database["public"]["Tables"]["quota_snapshots"]["Row"];
export type ModelQuotaHistoryRecord =
  Database["public"]["Tables"]["model_quota_history"]["Row"];

export interface ModelHistoryWithSnapshot extends ModelQuotaHistoryRecord {
  snapshot: {
    account_id: string;
    timestamp: string;
  };
}

export interface SnapshotData {
  models?: {
    modelId: string;
    modelProvider?: string;
    remainingPercentage: number;
    isExhausted?: boolean;
    label?: string;
  }[];
  promptCredits?: {
    available: number;
    monthly: number;
  };
}
