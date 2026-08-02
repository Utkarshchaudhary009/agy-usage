import "server-only";

import { createServerClient, createServiceClient } from "../supabase/server";
import type {
  ModelHistoryWithSnapshot,
  QuotaSnapshotRecord,
} from "../types/history";
import type { QuotaSnapshot } from "../types/quota";

export async function saveSnapshot(
  accountId: string,
  snapshot: QuotaSnapshot,
  options?: { asBackgroundJob?: boolean },
) {
  const supabase = options?.asBackgroundJob
    ? createServiceClient()
    : await createServerClient();

  // Insert into quota_snapshots
  const { data: snapshotData, error: snapshotError } = await supabase
    .from("quota_snapshots")
    .insert({
      account_id: accountId,
      timestamp: snapshot.timestamp,
      plan_type: snapshot.planType,
      prompt_credits_available: snapshot.promptCredits?.available,
      prompt_credits_monthly: snapshot.promptCredits?.monthly,
      snapshot_data: snapshot as unknown as import("../types/database").Json,
    })
    .select("id")
    .single();

  if (snapshotError || !snapshotData) {
    throw new Error(`Failed to save quota snapshot: ${snapshotError?.message}`);
  }

  // Insert into model_quota_history
  const modelInserts = snapshot.models.map((model) => ({
    snapshot_id: snapshotData.id,
    model_id: model.modelId,
    label: model.label,
    remaining_percentage: model.remainingPercentage,
    is_exhausted: model.isExhausted,
    reset_time: model.resetTime,
  }));

  if (modelInserts.length > 0) {
    const { error: modelsError } = await supabase
      .from("model_quota_history")
      .insert(modelInserts);

    if (modelsError) {
      throw new Error(
        `Failed to save model quota history: ${modelsError.message}`,
      );
    }
  }
}

export async function getHistory(
  accountId: string,
  from: Date,
  to: Date,
): Promise<QuotaSnapshotRecord[]> {
  const supabase = await createServerClient();

  const { data, error } = await supabase
    .from("quota_snapshots")
    .select("*")
    .eq("account_id", accountId)
    .gte("timestamp", from.toISOString())
    .lte("timestamp", to.toISOString())
    .order("timestamp", { ascending: true });

  if (error) {
    throw new Error(`Failed to fetch history: ${error.message}`);
  }

  return data;
}

export async function getModelHistory(
  accountId: string,
  modelId: string,
  from: Date,
  to: Date,
): Promise<ModelHistoryWithSnapshot[]> {
  const supabase = await createServerClient();

  // We need to join quota_snapshots and model_quota_history
  const { data, error } = await supabase
    .from("model_quota_history")
    .select(
      `
      *,
      snapshot:quota_snapshots!inner(account_id, timestamp)
    `,
    )
    .eq("snapshot.account_id", accountId)
    .eq("model_id", modelId)
    .gte("snapshot.timestamp", from.toISOString())
    .lte("snapshot.timestamp", to.toISOString())
    .order("timestamp", { foreignTable: "snapshot", ascending: true });

  if (error) {
    throw new Error(`Failed to fetch model history: ${error.message}`);
  }

  return data;
}
