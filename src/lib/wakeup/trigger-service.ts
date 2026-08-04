import "server-only";

import { streamGenerateContent } from "@/lib/google/cloudcode-client";
import { resolveProjectId } from "@/lib/google/project-resolver";
import { getValidAccessToken } from "@/lib/google/token-manager";
import { createServerClient, createServiceClient } from "@/lib/supabase/server";
import type { TriggerResult } from "@/lib/types/wakeup";

export async function triggerSingleModel(
  accountId: string,
  modelId: string,
  prompt: string,
  maxTokens: number,
): Promise<TriggerResult> {
  const startTime = Date.now();

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

    const durationMs = Date.now() - startTime;

    return {
      success: true,
      durationMs,
    };
  } catch (err) {
    const durationMs = Date.now() - startTime;

    return {
      success: false,
      durationMs,
      error: "Trigger failed",
    };
  }
}

async function logTriggerResult(
  supabase: ReturnType<typeof createServiceClient>,
  clerkUserId: string,
  accountId: string | null,
  modelId: string,
  triggerSource: "manual" | "scheduled" | "quota_reset",
  result: TriggerResult,
) {
  const { error } = await supabase.from("wakeup_logs").insert({
    clerk_user_id: clerkUserId,
    account_id: accountId,
    model_id: modelId,
    trigger_source: triggerSource,
    success: result.success,
    duration_ms: result.durationMs,
    error: result.error ?? null,
  });

  if (error) {
    console.error("Failed to log wakeup result:", error.message);
  }
}

export async function triggerAllModels(
  accountId: string,
  models: string[],
  prompt: string,
  maxTokens: number,
): Promise<TriggerResult[]> {
  return Promise.all(
    models.map((modelId) =>
      triggerSingleModel(accountId, modelId, prompt, maxTokens),
    ),
  );
}

export async function executeWakeup(clerkUserId: string): Promise<{
  success: boolean;
  results: TriggerResult[];
  totalDurationMs: number;
}> {
  const supabase = await createServerClient();

  const { data: config, error: configError } = await supabase
    .from("wakeup_configs")
    .select("*")
    .eq("clerk_user_id", clerkUserId)
    .single();

  if (configError || !config) {
    throw new Error("Wakeup config not found");
  }

  if (!config.enabled) {
    return {
      success: false,
      results: [],
      totalDurationMs: 0,
    };
  }

  const { data: accounts, error: accountsError } = await supabase
    .from("google_accounts")
    .select("id")
    .in("id", config.selected_account_ids)
    .eq("clerk_user_id", clerkUserId)
    .eq("is_active", true)
    .eq("token_status", "active");

  if (accountsError || !accounts) {
    throw new Error("Failed to fetch accounts");
  }

  if (accounts.length === 0) {
    return {
      success: false,
      results: [],
      totalDurationMs: 0,
    };
  }

  const allResults: TriggerResult[] = [];
  const totalStart = Date.now();
  const serviceClient = createServiceClient();

  for (const account of accounts) {
    const modelResults = await triggerAllModels(
      account.id,
      config.selected_models,
      config.custom_prompt,
      config.max_output_tokens,
    );

    const logPromises = modelResults.map((modelResult, i) =>
      logTriggerResult(
        serviceClient,
        clerkUserId,
        account.id,
        config.selected_models[i],
        "scheduled",
        modelResult,
      ),
    );
    await Promise.all(logPromises);

    allResults.push(...modelResults);
  }

  const totalDurationMs = Date.now() - totalStart;
  const overallSuccess = allResults.every((r) => r.success);

  return {
    success: overallSuccess,
    results: allResults,
    totalDurationMs,
  };
}
