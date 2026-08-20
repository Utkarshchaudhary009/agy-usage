import "server-only";

import { streamGenerateContent } from "@/lib/google/cloudcode-client";
import { CloudCodeAuthError } from "@/lib/google/errors";
import { resolveProjectId } from "@/lib/google/project-resolver";
import {
  getValidAccessToken,
  type TokenAccessOptions,
} from "@/lib/google/token-manager";
import { createServiceClient } from "@/lib/supabase/server";
import { endWakeupAttempt } from "@/lib/wakeup/cooldown";

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

export type TriggerSource = "manual" | "scheduled" | "quota_reset";

export interface ExecuteWakeupOptions {
  asBackgroundJob?: boolean;
  triggerSource?: TriggerSource;
}

// Small pause between sequential model triggers on the same account to avoid
// hammering the Cloud Code endpoint in a tight loop.
const INTER_MODEL_DELAY_MS = 100;

export async function triggerSingleModel(
  accountId: string,
  modelId: string,
  prompt: string,
  maxTokens: number,
  options?: TokenAccessOptions,
): Promise<TriggerResult> {
  const startTime = Date.now();
  let success = false;
  let error: string | undefined;

  try {
    const accessToken = await getValidAccessToken(accountId, options);
    const projectId = await resolveProjectId(accountId, options);

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
  options?: TokenAccessOptions,
): Promise<TriggerResult[]> {
  const results: TriggerResult[] = [];

  for (const modelId of models) {
    const result = await triggerSingleModel(
      accountId,
      modelId,
      prompt,
      maxTokens,
      options,
    );
    results.push(result);

    await new Promise((resolve) => setTimeout(resolve, INTER_MODEL_DELAY_MS));
  }

  return results;
}

export async function executeWakeup(
  clerkUserId: string,
  attemptId?: string,
  options?: ExecuteWakeupOptions,
): Promise<WakeupResult> {
  const supabase = createServiceClient();

  const triggerSource: TriggerSource = options?.triggerSource ?? "manual";
  const tokenOptions: TokenAccessOptions = {
    asBackgroundJob: options?.asBackgroundJob === true,
  };
  let anyLogFailed = false;

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

    // An explicit (non-empty) selection is honored as an `IN` filter; an empty
    // selection means "all of my accounts", matching the UI's promise.
    let accounts: { id: string }[] = [];
    if (config.selected_account_ids && config.selected_account_ids.length > 0) {
      const { data: accountsData } = await supabase
        .from("google_accounts")
        .select("id")
        .eq("clerk_user_id", clerkUserId)
        .in("id", config.selected_account_ids);
      accounts = accountsData || [];
    } else {
      const { data: accountsData } = await supabase
        .from("google_accounts")
        .select("id")
        .eq("clerk_user_id", clerkUserId);
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
        tokenOptions,
      );

      results.push(...accountResults);
      successfulTriggers += accountResults.filter((r) => r.success).length;
      failedTriggers += accountResults.filter((r) => !r.success).length;

      for (const result of accountResults) {
        const logged = await logTrigger(
          clerkUserId,
          account.id,
          result.modelId,
          triggerSource,
          result.success,
          result.durationMs,
          result.error,
        );
        if (!logged) anyLogFailed = true;
      }
    }

    // Only release the cooldown reservation when every audit row was persisted.
    // If a log insert failed we keep the reservation (its created_at anchors the
    // cooldown) rather than silently dropping the cooldown protection.
    return {
      success: results.length > 0 && failedTriggers === 0,
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
  } finally {
    // Only release the cooldown reservation when every audit row was persisted.
    // If a log insert failed we keep the reservation (its created_at anchors the
    // cooldown) rather than silently dropping the cooldown protection.
    if (attemptId && !anyLogFailed) {
      await endWakeupAttempt(attemptId);
    }
  }
}

async function markAccountRevoked(accountId: string): Promise<void> {
  const supabase = createServiceClient();

  await supabase
    .from("google_accounts")
    .update({ token_status: "revoked" })
    .eq("id", accountId);
}

export async function logTrigger(
  clerkUserId: string,
  accountId: string,
  modelId: string,
  triggerSource: TriggerSource,
  success: boolean,
  durationMs?: number,
  error?: string,
): Promise<boolean> {
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
    return false;
  }
  return true;
}
