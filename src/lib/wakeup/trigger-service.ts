import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { streamGenerateContent } from "@/lib/google/cloudcode-client";
import { resolveProjectId } from "@/lib/google/project-resolver";
import { getValidAccessToken } from "@/lib/google/token-manager";
import { createServerClient } from "@/lib/supabase/server";
import type { Database } from "@/lib/types/database";
import type { TriggerSource, WakeupConfig } from "@/lib/types/wakeup";
import { isOnCooldown } from "./cooldown";

export interface TriggerResult {
  success: boolean;
  durationMs: number;
  error?: string;
  modelId: string;
  accountId: string;
  responsePreview?: string;
}

export interface WakeupResult {
  success: boolean;
  triggeredModels: number;
  failedModels: number;
  results: TriggerResult[];
  cooldownSkipped?: boolean;
}

const PREVIEW_MAX_LENGTH = 200;
const TRIGGER_TIMEOUT_MS = 30_000;

export async function triggerSingleModel(
  accountId: string,
  modelId: string,
  prompt: string,
  maxTokens: number,
  clerkUserId: string,
  supabase: SupabaseClient<Database>,
  triggerSource: TriggerSource,
): Promise<TriggerResult> {
  const startTime = Date.now();

  try {
    const accessToken = await getValidAccessToken(accountId, {
      asBackgroundJob: true,
    });

    const projectId = await resolveProjectId(accountId, {
      asBackgroundJob: true,
    });

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), TRIGGER_TIMEOUT_MS);

    let result: TriggerResult;
    try {
      const response = await streamGenerateContent(
        accessToken,
        accountId,
        projectId,
        modelId,
        prompt,
        maxTokens,
      );

      const durationMs = Date.now() - startTime;
      const preview = response.text
        .slice(0, PREVIEW_MAX_LENGTH)
        .replace(/\n/g, " ")
        .trim();

      result = {
        success: true,
        durationMs,
        modelId,
        accountId,
        responsePreview: preview,
      };
    } finally {
      clearTimeout(timeoutId);
    }

    await logWakeupResult(supabase, clerkUserId, result, triggerSource);
    return result;
  } catch (err) {
    const durationMs = Date.now() - startTime;
    const errorMessage = err instanceof Error ? err.message : "Unknown error";

    const result: TriggerResult = {
      success: false,
      durationMs,
      error: errorMessage,
      modelId,
      accountId,
    };

    await logWakeupResult(supabase, clerkUserId, result, triggerSource);
    return result;
  }
}

async function logWakeupResult(
  supabase: SupabaseClient<Database>,
  clerkUserId: string,
  result: TriggerResult,
  triggerSource: TriggerSource,
): Promise<void> {
  try {
    await supabase.from("wakeup_logs").insert({
      clerk_user_id: clerkUserId,
      account_id: result.accountId,
      model_id: result.modelId,
      trigger_source: triggerSource,
      success: result.success,
      duration_ms: result.durationMs,
      error: result.error ?? null,
      response_preview: result.responsePreview ?? null,
    });
  } catch (err) {
    console.error("Failed to log wakeup result:", err);
  }
}

export async function triggerAllModels(
  accountId: string,
  models: string[],
  prompt: string,
  maxTokens: number,
  clerkUserId: string,
  supabase: SupabaseClient<Database>,
  triggerSource: TriggerSource,
): Promise<TriggerResult[]> {
  const results: TriggerResult[] = [];

  for (const modelId of models) {
    const result = await triggerSingleModel(
      accountId,
      modelId,
      prompt,
      maxTokens,
      clerkUserId,
      supabase,
      triggerSource,
    );
    results.push(result);
  }

  return results;
}

export async function executeWakeup(
  clerkUserId: string,
  triggerSource: TriggerSource = "scheduled",
): Promise<WakeupResult> {
  const supabase = await createServerClient();

  const { data: config } = await supabase
    .from("wakeup_configs")
    .select("*")
    .eq("clerk_user_id", clerkUserId)
    .maybeSingle();

  if (!config) {
    return {
      success: true,
      triggeredModels: 0,
      failedModels: 0,
      results: [],
    };
  }

  const wakeupConfig: WakeupConfig = {
    id: config.id,
    clerkUserId: config.clerk_user_id,
    enabled: config.enabled,
    selectedModels: config.selected_models ?? [],
    selectedAccountIds: config.selected_account_ids ?? [],
    scheduleMode: config.schedule_mode,
    intervalHours: config.interval_hours,
    dailyTimes: config.daily_times ?? [],
    cronExpression: config.cron_expression,
    customPrompt: config.custom_prompt,
    maxOutputTokens: config.max_output_tokens,
    cooldownMinutes: config.cooldown_minutes,
    wakeOnReset: config.wake_on_reset,
    updatedAt: config.updated_at,
  };

  if (!wakeupConfig.enabled) {
    return {
      success: true,
      triggeredModels: 0,
      failedModels: 0,
      results: [],
    };
  }

  const onCooldown = await isOnCooldown(clerkUserId, supabase);
  if (onCooldown) {
    return {
      success: true,
      triggeredModels: 0,
      failedModels: 0,
      results: [],
      cooldownSkipped: true,
    };
  }

  const accountQuery = supabase
    .from("google_accounts")
    .select("id, email, token_status")
    .eq("clerk_user_id", clerkUserId)
    .eq("is_active", true)
    .eq("token_status", "active");

  if (wakeupConfig.selectedAccountIds.length > 0) {
    accountQuery.in("id", wakeupConfig.selectedAccountIds);
  }

  const { data: accounts, error: accountsError } = await accountQuery;

  if (accountsError || !accounts) {
    console.error("Failed to load accounts for wakeup:", accountsError);
    return {
      success: false,
      triggeredModels: 0,
      failedModels: 0,
      results: [],
    };
  }

  const allResults: TriggerResult[] = [];

  for (const account of accounts) {
    const results = await triggerAllModels(
      account.id,
      wakeupConfig.selectedModels,
      wakeupConfig.customPrompt,
      wakeupConfig.maxOutputTokens,
      clerkUserId,
      supabase,
      triggerSource,
    );
    allResults.push(...results);
  }

  const triggeredModels = allResults.filter((r) => r.success).length;
  const failedModels = allResults.filter((r) => !r.success).length;

  return {
    success: failedModels === 0,
    triggeredModels,
    failedModels,
    results: allResults,
  };
}
