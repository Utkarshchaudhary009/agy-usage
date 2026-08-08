import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { streamGenerateContent } from "@/lib/google/cloudcode-client";
import { resolveProjectId } from "@/lib/google/project-resolver";
import { getValidAccessToken } from "@/lib/google/token-manager";
import { createServerClient, createServiceClient } from "@/lib/supabase/server";
import type { Database } from "@/lib/types/database";
import type { TriggerAllResult, TriggerSingleResult } from "@/lib/types/wakeup";
import { getWakeupConfig } from "./config";
import { getCooldownStatus } from "./cooldown";

// Returns the calling user's own linked account ids. Used to expand an empty
// account selection ("trigger all my accounts") into concrete targets.
async function getClerkAccountIds(
  supabase: SupabaseClient<Database>,
  clerkUserId: string,
): Promise<string[]> {
  const { data, error } = await supabase
    .from("google_accounts")
    .select("id")
    .eq("clerk_user_id", clerkUserId);

  if (error) {
    console.error("Failed to load accounts for wakeup:", error);
    return [];
  }
  return (data ?? []).map((row) => row.id);
}

export async function triggerSingleModel(
  accountId: string,
  modelId: string,
  prompt: string,
  maxOutputTokens: number,
  options?: { asBackgroundJob?: boolean },
): Promise<TriggerSingleResult> {
  const startTime = Date.now();
  let success = false;
  let error: string | undefined;
  let responsePreview: string | undefined;

  try {
    const accessToken = await getValidAccessToken(accountId, options);
    const projectId = await resolveProjectId(accountId, options);

    const result = await streamGenerateContent(
      accessToken,
      accountId,
      projectId,
      modelId,
      prompt,
      maxOutputTokens,
    );

    success = true;
    responsePreview = result.text?.slice(0, 200) || undefined;
  } catch (err: unknown) {
    success = false;
    error = err instanceof Error ? err.message : String(err);
  }

  return {
    accountId,
    modelId,
    success,
    durationMs: Date.now() - startTime,
    error,
    responsePreview,
  };
}

export async function triggerAllModels(
  accountId: string,
  models: string[],
  prompt: string,
  maxOutputTokens: number,
  options?: { asBackgroundJob?: boolean },
): Promise<TriggerSingleResult[]> {
  const results: TriggerSingleResult[] = [];

  for (const modelId of models) {
    const result = await triggerSingleModel(
      accountId,
      modelId,
      prompt,
      maxOutputTokens,
      options,
    );
    results.push(result);

    if (results.length < models.length) {
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }

  return results;
}

async function logResults(
  clerkUserId: string,
  results: TriggerSingleResult[],
  triggerSource: "manual" | "scheduled",
): Promise<void> {
  const supabase = createServiceClient();

  const logInserts = results.map((r) => ({
    clerk_user_id: clerkUserId,
    account_id: r.accountId,
    model_id: r.modelId,
    trigger_source: triggerSource,
    success: r.success,
    duration_ms: r.durationMs,
    error: r.error || null,
    response_preview: r.responsePreview || null,
  }));

  const { error } = await supabase.from("wakeup_logs").insert(logInserts);

  if (error) {
    console.error("Failed to save wakeup logs:", error);
  }
}

export async function executeWakeup(
  clerkUserId: string,
  options?: { asBackgroundJob?: boolean },
): Promise<TriggerAllResult> {
  const supabase = options?.asBackgroundJob
    ? createServiceClient()
    : await createServerClient();

  const config = await getWakeupConfig(supabase, clerkUserId);
  if (!config || !config.enabled) {
    return {
      clerkUserId,
      results: [],
      skipped: true,
      skipReason: "Wakeup not enabled",
    };
  }

  const cooldownStatus = await getCooldownStatus(clerkUserId, options);
  if (cooldownStatus.onCooldown) {
    return {
      clerkUserId,
      results: [],
      skipped: true,
      skipReason: "On cooldown",
    };
  }

  // An empty selection means "all of my linked accounts" (per the config UI).
  // Resolve them here so the rest of the flow can treat the list uniformly.
  const targetAccountIds =
    config.selectedAccountIds.length > 0
      ? config.selectedAccountIds
      : await getClerkAccountIds(supabase, clerkUserId);

  if (targetAccountIds.length === 0) {
    return {
      clerkUserId,
      results: [],
      skipped: true,
      skipReason: "No accounts selected",
    };
  }

  const allResults: TriggerSingleResult[] = [];

  for (const accountId of targetAccountIds) {
    const results = await triggerAllModels(
      accountId,
      config.selectedModels,
      config.customPrompt,
      config.maxOutputTokens,
      options,
    );
    allResults.push(...results);
  }

  const triggerSource = options?.asBackgroundJob ? "scheduled" : "manual";
  await logResults(clerkUserId, allResults, triggerSource);

  return {
    clerkUserId,
    results: allResults,
    skipped: false,
  };
}
