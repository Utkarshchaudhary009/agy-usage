import "server-only";

import { streamGenerateContent } from "@/lib/google/cloudcode-client";
import { CloudCodeAuthError } from "@/lib/google/errors";
import { resolveProjectId } from "@/lib/google/project-resolver";
import { getValidAccessToken } from "@/lib/google/token-manager";
import { createServiceClient } from "@/lib/supabase/server";

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

    const _generateResponse = await streamGenerateContent(
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
): Promise<TriggerResult[]> {
  const results: TriggerResult[] = [];

  for (const modelId of models) {
    const result = await triggerSingleModel(accountId, modelId, prompt, 1);
    results.push(result);

    await new Promise((resolve) => setTimeout(resolve, 100));
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

    const onCooldown = await isOnCooldown(clerkUserId, config.cooldown_minutes);
    if (onCooldown) {
      const nextAllowedAt = await getNextAllowedTime(
        clerkUserId,
        config.cooldown_minutes,
      );
      return {
        success: true,
        totalModels: 0,
        successfulTriggers: 0,
        failedTriggers: 0,
        results: [],
        nextAllowedAt,
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

export async function isOnCooldown(
  clerkUserId: string,
  cooldownMinutes: number,
): Promise<boolean> {
  const supabase = createServiceClient();

  const { data: lastLog } = await supabase
    .from("wakeup_logs")
    .select("created_at")
    .eq("clerk_user_id", clerkUserId)
    .order("created_at", { ascending: false })
    .limit(1)
    .single();

  if (!lastLog) return false;

  const lastTriggerTime = new Date(lastLog.created_at);
  const now = new Date();
  const cooldownMs = cooldownMinutes * 60 * 1000;

  return now.getTime() - lastTriggerTime.getTime() < cooldownMs;
}

export async function getNextAllowedTime(
  clerkUserId: string,
  cooldownMinutes: number,
): Promise<string> {
  const supabase = createServiceClient();

  const { data: lastLog } = await supabase
    .from("wakeup_logs")
    .select("created_at")
    .eq("clerk_user_id", clerkUserId)
    .order("created_at", { ascending: false })
    .limit(1)
    .single();

  if (!lastLog) {
    return new Date().toISOString();
  }

  const nextAllowed = new Date(lastLog.created_at);
  nextAllowed.setMinutes(nextAllowed.getMinutes() + cooldownMinutes);

  return nextAllowed.toISOString();
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
