import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { streamGenerateContent } from "@/lib/google/cloudcode-client";
import { CloudCodeAuthError } from "@/lib/google/errors";
import { resolveProjectId } from "@/lib/google/project-resolver";
import { getValidAccessToken } from "@/lib/google/token-manager";
import { createServerClient, createServiceClient } from "@/lib/supabase/server";
import type { Database } from "@/lib/types/database";
import { DEFAULT_WAKEUP_CONFIG } from "@/lib/types/wakeup";
import { beginWakeup } from "./cooldown";

export type TriggerSource = "manual" | "scheduled" | "quota_reset";

export interface TriggerResult {
  accountId: string;
  modelId: string;
  success: boolean;
  durationMs: number;
  error?: string;
  responsePreview?: string;
}

export type WakeupSkipReason =
  | "cooldown"
  | "no_config"
  | "disabled"
  | "no_models"
  | "no_accounts";

export interface WakeupResult {
  clerkUserId: string;
  triggered: boolean;
  skippedReason?: WakeupSkipReason;
  results: TriggerResult[];
  durationMs: number;
  successCount: number;
  failureCount: number;
}

interface TriggerContext {
  clerkUserId: string;
  triggerSource: TriggerSource;
  asBackgroundJob?: boolean;
  prompt?: string;
  maxOutputTokens?: number;
}

/** Cap on the text we persist per trigger so logs stay small. */
const RESPONSE_PREVIEW_MAX = 200;

async function createClient(
  asBackgroundJob: boolean,
): Promise<SupabaseClient<Database>> {
  return asBackgroundJob ? createServiceClient() : await createServerClient();
}

async function logTrigger(
  supabase: SupabaseClient<Database>,
  params: {
    clerkUserId: string;
    accountId: string;
    modelId: string;
    triggerSource: TriggerSource;
    success: boolean;
    durationMs: number;
    error?: string | null;
    responsePreview?: string | null;
  },
): Promise<void> {
  const { error } = await supabase.from("wakeup_logs").insert({
    clerk_user_id: params.clerkUserId,
    account_id: params.accountId,
    model_id: params.modelId,
    trigger_source: params.triggerSource,
    success: params.success,
    duration_ms: params.durationMs,
    error: params.error ?? null,
    response_preview: params.responsePreview ?? null,
  });

  if (error) {
    // Best-effort audit log; a failed insert must not mask the trigger outcome.
    console.error("Failed to record wakeup log", {
      accountId: params.accountId,
      modelId: params.modelId,
      error: error.message,
    });
  }
}

/**
 * Wakes a single model on a single account. Resolves a fresh access token,
 * resolves the Cloud Code project, fires a minimal generate call (the client
 * aborts after the first chunk), records the outcome to `wakeup_logs`, and
 * returns a normalized result. Never throws — failures are reported in the
 * result so a single bad model does not abort the whole wakeup.
 */
export async function triggerSingleModel(
  accountId: string,
  modelId: string,
  prompt: string,
  maxOutputTokens: number = DEFAULT_WAKEUP_CONFIG.maxOutputTokens,
  context: TriggerContext,
): Promise<TriggerResult> {
  const startedAt = Date.now();
  const supabase = await createClient(context.asBackgroundJob === true);

  let success = false;
  let error: string | undefined;
  let responsePreview: string | undefined;

  try {
    const accessToken = await getValidAccessToken(accountId, {
      asBackgroundJob: context.asBackgroundJob,
    });
    const projectId = await resolveProjectId(accountId, {
      asBackgroundJob: context.asBackgroundJob,
    });

    const result = await streamGenerateContent(
      accessToken,
      accountId,
      projectId,
      modelId,
      prompt,
      maxOutputTokens,
    );

    success = true;
    if (result.text) {
      responsePreview = result.text.slice(0, RESPONSE_PREVIEW_MAX);
    }
  } catch (err) {
    error =
      err instanceof CloudCodeAuthError
        ? "Token revoked or invalid. Re-link the account."
        : err instanceof Error
          ? err.message
          : String(err);
  }

  const durationMs = Date.now() - startedAt;
  await logTrigger(supabase, {
    clerkUserId: context.clerkUserId,
    accountId,
    modelId,
    triggerSource: context.triggerSource,
    success,
    durationMs,
    error: error ?? null,
    responsePreview: responsePreview ?? null,
  });

  return { accountId, modelId, success, durationMs, error, responsePreview };
}

/**
 * Sequentially wakes every model for an account to avoid hammering the same
 * account with parallel requests (which risks rate limits).
 */
export async function triggerAllModels(
  accountId: string,
  models: string[],
  prompt: string,
  context: TriggerContext,
): Promise<TriggerResult[]> {
  const results: TriggerResult[] = [];
  for (const modelId of models) {
    const result = await triggerSingleModel(
      accountId,
      modelId,
      prompt,
      context.maxOutputTokens,
      context,
    );
    results.push(result);
  }
  return results;
}

export interface ExecuteWakeupOptions {
  asBackgroundJob?: boolean;
  triggerSource?: TriggerSource;
  /** Bypass the cooldown check (e.g. for a forced re-wake). */
  bypassCooldown?: boolean;
}

/**
 * Runs a full wakeup for a user: loads their config, picks the target accounts,
 * and triggers every selected model on each account. Respects the cooldown
 * unless `bypassCooldown` is set. Returns an aggregate result describing what
 * happened, including a `skippedReason` when the wakeup did not run.
 */
export async function executeWakeup(
  clerkUserId: string,
  options?: ExecuteWakeupOptions,
): Promise<WakeupResult> {
  const startedAt = Date.now();
  const asBackgroundJob = options?.asBackgroundJob === true;
  const triggerSource = options?.triggerSource ?? "scheduled";
  const supabase = await createClient(asBackgroundJob);

  const skip = (reason: WakeupSkipReason): WakeupResult => ({
    clerkUserId,
    triggered: false,
    skippedReason: reason,
    results: [],
    durationMs: Date.now() - startedAt,
    successCount: 0,
    failureCount: 0,
  });

  const { data: config } = await supabase
    .from("wakeup_configs")
    .select(
      "enabled, selected_models, selected_account_ids, custom_prompt, max_output_tokens, cooldown_minutes",
    )
    .eq("clerk_user_id", clerkUserId)
    .maybeSingle();

  if (!config) return skip("no_config");
  if (!config.enabled) return skip("disabled");

  if (!options?.bypassCooldown) {
    // Atomic check-and-claim: under a per-user advisory lock this stamps the
    // cooldown boundary, so a concurrent wakeup (manual click vs scheduled job,
    // or two Inngest workers) cannot also pass the gate and stampede the API.
    // A false return means the cooldown is still active and we must not fire.
    const cooldownMinutes =
      config.cooldown_minutes ?? DEFAULT_WAKEUP_CONFIG.cooldownMinutes;
    if (!(await beginWakeup(clerkUserId, cooldownMinutes, asBackgroundJob))) {
      return skip("cooldown");
    }
  }

  const models: string[] = config.selected_models ?? [];
  if (models.length === 0) return skip("no_models");

  const { data: accounts } = await supabase
    .from("google_accounts")
    .select("id")
    .eq("clerk_user_id", clerkUserId)
    .eq("token_status", "active");

  if (!accounts || accounts.length === 0) return skip("no_accounts");

  const selected = config.selected_account_ids ?? [];
  const selectedSet = new Set(selected);
  const accountIds =
    selected.length > 0
      ? accounts.map((a) => a.id).filter((id) => selectedSet.has(id))
      : accounts.map((a) => a.id);

  if (accountIds.length === 0) return skip("no_accounts");

  const prompt = config.custom_prompt ?? DEFAULT_WAKEUP_CONFIG.customPrompt;
  const context: TriggerContext = {
    clerkUserId,
    triggerSource,
    asBackgroundJob,
    prompt,
    maxOutputTokens: config.max_output_tokens ?? 1,
  };

  const allResults: TriggerResult[] = [];
  for (const accountId of accountIds) {
    const perAccount = await triggerAllModels(
      accountId,
      models,
      prompt,
      context,
    );
    allResults.push(...perAccount);
  }

  const successCount = allResults.filter((r) => r.success).length;
  const failureCount = allResults.length - successCount;

  return {
    clerkUserId,
    triggered: true,
    results: allResults,
    durationMs: Date.now() - startedAt,
    successCount,
    failureCount,
  };
}
