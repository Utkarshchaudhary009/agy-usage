import "server-only";

import { streamGenerateContent } from "@/lib/google/cloudcode-client";
import { CloudCodeAuthError } from "@/lib/google/errors";
import { resolveProjectId } from "@/lib/google/project-resolver";
import { getValidAccessToken } from "@/lib/google/token-manager";
import { createServiceClient } from "@/lib/supabase/server";
import { isOnCooldown } from "@/lib/wakeup/cooldown";

export interface TriggerResult {
  modelId: string;
  success: boolean;
  durationMs: number;
  error?: string;
}

export interface WakeupResult {
  success: boolean;
  totalModels: number;
  successfulTriggers: number;
  failedTriggers: number;
  results: TriggerResult[];
  nextAllowedAt?: string;
  error?: string;
}

// Small pause between sequential model triggers on the same account to avoid
// hammering the Cloud Code endpoint in a tight loop.
const INTER_MODEL_DELAY_MS = 100;

export async function triggerSingleModel(
  accountId: string,
  modelId: string,
  prompt: string,
  maxTokens: number,
): Promise<TriggerResult> {
  const startTime = Date.now();
  let success = false;
  let error: string | undefined;

  try {
    const accessToken = await getValidAccessToken(accountId);
    const projectId = await resolveProjectId(accountId);

    await streamGenerateContent(
      accessToken,
      accountId,
      projectId,
      modelId,
      prompt,
      maxTokens,
    );

    success = true;

    return {
      modelId,
      success,
      durationMs: Date.now() - startTime,
    };
  } catch (err) {
    error = err instanceof Error ? err.message : String(err);

    if (err instanceof CloudCodeAuthError) {
      await markAccountRevoked(accountId);
    }

    return {
      modelId,
      success: false,
      durationMs: Date.now() - startTime,
      error,
    };
  }
}

export async function triggerAllModels(
  accountId: string,
  models: string[],
  prompt: string,
  maxTokens: number,
): Promise<TriggerResult[]> {
  const results: TriggerResult[] = [];

  for (const modelId of models) {
    const result = await triggerSingleModel(
      accountId,
      modelId,
      prompt,
      maxTokens,
    );
    results.push(result);

    await new Promise((resolve) => setTimeout(resolve, INTER_MODEL_DELAY_MS));
  }

  return results;
}

export async function executeWakeup(
  clerkUserId: string,
): Promise<WakeupResult> {
  const supabase = createServiceClient();

  try {
    const { data: config, error: configError } = await supabase
      .from("wakeup_configs")
      .select("*")
      .eq("clerk_user_id", clerkUserId)
      .single();

    if (configError || !config) {
      return {
        success: false,
        totalModels: 0,
        successfulTriggers: 0,
        failedTriggers: 0,
        results: [],
        error: "Wakeup config not found",
      };
    }

    if (!config.enabled) {
      return {
        success: false,
        totalModels: 0,
        successfulTriggers: 0,
        failedTriggers: 0,
        results: [],
        error: "Wakeup is disabled",
      };
    }

    const cooldownInfo = await isOnCooldown(clerkUserId);
    if (cooldownInfo.onCooldown) {
      return {
        success: false,
        totalModels: 0,
        successfulTriggers: 0,
        failedTriggers: 0,
        results: [],
        nextAllowedAt: cooldownInfo.nextAllowedAt,
        error: "On cooldown",
      };
    }

    let accounts: { id: string }[] = [];
    if (config.selected_account_ids && config.selected_account_ids.length > 0) {
      const { data: accountsData } = await supabase
        .from("google_accounts")
        .select("id")
        .eq("clerk_user_id", clerkUserId)
        .in("id", config.selected_account_ids);
      accounts = accountsData || [];
    }

    const results: TriggerResult[] = [];
    let successfulTriggers = 0;
    let failedTriggers = 0;

    for (const account of accounts) {
      if (!config.selected_models || config.selected_models.length === 0) {
        continue;
      }

      const accountResults = await triggerAllModels(
        account.id,
        config.selected_models,
        config.custom_prompt || "hi",
        config.max_output_tokens,
      );

      results.push(...accountResults);
      successfulTriggers += accountResults.filter((r) => r.success).length;
      failedTriggers += accountResults.filter((r) => !r.success).length;

      for (const result of accountResults) {
        await logTrigger(
          clerkUserId,
          account.id,
          result.modelId,
          "manual",
          result.success,
          result.durationMs,
          result.error,
        );
      }
    }

    return {
      success: true,
      totalModels: results.length,
      successfulTriggers,
      failedTriggers,
      results,
    };
  } catch (err) {
    return {
      success: false,
      totalModels: 0,
      successfulTriggers: 0,
      failedTriggers: 0,
      results: [],
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

async function markAccountRevoked(accountId: string): Promise<void> {
  const supabase = createServiceClient();

  await supabase
    .from("google_accounts")
    .update({ token_status: "revoked" })
    .eq("id", accountId);
}

async function logTrigger(
  clerkUserId: string,
  accountId: string,
  modelId: string,
  triggerSource: "manual" | "scheduled" | "quota_reset",
  success: boolean,
  durationMs?: number,
  error?: string,
): Promise<void> {
  const supabase = createServiceClient();

  const { error: insertError } = await supabase.from("wakeup_logs").insert({
    clerk_user_id: clerkUserId,
    account_id: accountId,
    model_id: modelId,
    trigger_source: triggerSource,
    success,
    duration_ms: durationMs,
    error,
  });

  if (insertError) {
    console.error("Failed to log trigger:", insertError);
  }
}
