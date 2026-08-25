import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { streamGenerateContent } from "@/lib/google/cloudcode-client";
import { resolveProjectId } from "@/lib/google/project-resolver";
import { getValidAccessToken } from "@/lib/google/token-manager";
import { createServerClient, createServiceClient } from "@/lib/supabase/server";
import type { Database } from "@/lib/types/database";
import type { TriggerAllResult, TriggerSingleResult } from "@/lib/types/wakeup";
import type { WakeupJobOptions } from "./cooldown";
import { toWakeupConfig } from "./mapper";

// Pause between models so a burst of triggers never looks like an attack to
// Google's rate limiter.
const INTER_MODEL_DELAY_MS = 1000;

/** How much of the model's reply is kept as a debugging preview. */
const RESPONSE_PREVIEW_LENGTH = 200;

/**
 * Ceiling on linked accounts expanded from an empty selection. Mirrors the
 * MAX selectedAccountIds bound enforced by config validation, so both ways of
 * arriving at a target list share one ceiling.
 */
const MAX_EXPANDED_ACCOUNTS = 50;

type TriggerSource = "manual" | "scheduled";

/**
 * Returns ALL of the user's own linked account ids (id-only columns, RLS- or
 * user-scoped so the row count is inherently small). Used both to expand an
 * empty account selection ("trigger all my accounts") and to filter stale ids
 * out of a saved selection — the latter must never be capped, or a legitimate
 * selection would be silently dropped for users with many accounts.
 */
async function getOwnedAccountIds(
  supabase: SupabaseClient<Database>,
  clerkUserId: string,
): Promise<string[]> {
  const { data, error } = await supabase
    .from("google_accounts")
    .select("id")
    .eq("clerk_user_id", clerkUserId);

  if (error) {
    // Detail stays server-side: the Postgres message leaks schema and policy
    // names, and this error can surface in a rendered error boundary.
    console.error("Failed to load accounts for wakeup:", error);
    throw new Error("Failed to load accounts for wakeup");
  }
  return (data ?? []).map((row) => row.id);
}

async function loadWakeupConfig(
  supabase: SupabaseClient<Database>,
  clerkUserId: string,
) {
  const { data: row, error } = await supabase
    .from("wakeup_configs")
    .select("*")
    .eq("clerk_user_id", clerkUserId)
    .maybeSingle();

  if (error) {
    // Detail stays server-side: the Postgres message leaks schema and policy
    // names, and this error can surface in a rendered error boundary.
    console.error("Failed to load wakeup config:", error);
    throw new Error("Failed to load wakeup config");
  }
  return row ? toWakeupConfig(row) : null;
}

export async function triggerSingleModel(
  accountId: string,
  modelId: string,
  prompt: string,
  maxOutputTokens: number,
  options?: WakeupJobOptions,
  resolvedProjectId?: string,
): Promise<TriggerSingleResult> {
  const startTime = Date.now();
  let success = false;
  let error: string | undefined;
  let responsePreview: string | undefined;

  try {
    const accessToken = await getValidAccessToken(accountId, options);
    const projectId =
      resolvedProjectId ?? (await resolveProjectId(accountId, options));

    const result = await streamGenerateContent(
      accessToken,
      accountId,
      projectId,
      modelId,
      prompt,
      maxOutputTokens,
    );

    success = true;
    responsePreview =
      result.text?.slice(0, RESPONSE_PREVIEW_LENGTH) || undefined;
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
  options?: WakeupJobOptions,
): Promise<TriggerSingleResult[]> {
  const startTime = Date.now();

  // Every model on the same account resolves to the same Cloud Code project,
  // so the lookup (a DB read plus possible loadCodeAssist/onboard round-trips)
  // happens once per account instead of once per model.
  let resolvedProjectId: string;
  try {
    resolvedProjectId = await resolveProjectId(accountId, options);
  } catch (err: unknown) {
    const error = err instanceof Error ? err.message : String(err);
    return models.map((modelId) => ({
      accountId,
      modelId,
      success: false,
      durationMs: Date.now() - startTime,
      error,
    }));
  }

  const results: TriggerSingleResult[] = [];

  for (const [index, modelId] of models.entries()) {
    const result = await triggerSingleModel(
      accountId,
      modelId,
      prompt,
      maxOutputTokens,
      options,
      resolvedProjectId,
    );
    results.push(result);

    if (index < models.length - 1) {
      await new Promise((resolve) => setTimeout(resolve, INTER_MODEL_DELAY_MS));
    }
  }

  return results;
}

/**
 * Persists trigger outcomes to wakeup_logs. Logs are written exclusively by
 * the service-role client because migration 009 deliberately grants no INSERT
 * policy on wakeup_logs — history must not be forgeable from the browser.
 */
export async function logTriggerResults(
  clerkUserId: string,
  results: TriggerSingleResult[],
  triggerSource: TriggerSource,
): Promise<void> {
  if (results.length === 0) return;

  const supabase = createServiceClient();

  const logInserts = results.map((result) => ({
    clerk_user_id: clerkUserId,
    account_id: result.accountId,
    model_id: result.modelId,
    trigger_source: triggerSource,
    success: result.success,
    duration_ms: result.durationMs,
    error: result.error || null,
    response_preview: result.responsePreview || null,
  }));

  const { error } = await supabase.from("wakeup_logs").insert(logInserts);

  if (error) {
    // Best effort: a failed history write must not fail the run itself, but it
    // should be visible in server logs.
    console.error("Failed to save wakeup logs:", error);
  }
}

/**
 * Runs a full wakeup for one user: every selected account × every selected
 * model, sequentially. Skips (with a reason) instead of throwing when the
 * config is missing/disabled, there are no target accounts, or another run
 * holds the cooldown window.
 *
 * The cooldown window is claimed atomically *before* any upstream work via
 * claim_wakeup_run(), so a manual trigger racing a scheduled run cannot
 * double-fire against Google.
 */
export async function executeWakeup(
  clerkUserId: string,
  options?: WakeupJobOptions,
): Promise<TriggerAllResult> {
  const supabase = options?.asBackgroundJob
    ? createServiceClient()
    : await createServerClient();

  const config = await loadWakeupConfig(supabase, clerkUserId);
  if (!config || !config.enabled) {
    return {
      clerkUserId,
      results: [],
      skipped: true,
      skipReason: "Wakeup not enabled",
    };
  }

  // Resolve target accounts before claiming the cooldown window, so a no-op
  // run with no target accounts never stamps a cooldown. An empty selection
  // means "all of my linked accounts" (per the config UI), capped to the same
  // ceiling config validation enforces for explicit selections. A saved
  // selection is intersected with currently-owned accounts: background jobs
  // bypass RLS via the service-role client, so a stale id left behind by a
  // concurrent account deletion must be filtered here rather than trusted.
  const ownedAccountIds = new Set(
    await getOwnedAccountIds(supabase, clerkUserId),
  );
  const targetAccountIds =
    config.selectedAccountIds.length > 0
      ? config.selectedAccountIds.filter((id) => ownedAccountIds.has(id))
      : [...ownedAccountIds].slice(0, MAX_EXPANDED_ACCOUNTS);

  if (targetAccountIds.length === 0) {
    return {
      clerkUserId,
      results: [],
      skipped: true,
      skipReason: "No accounts linked",
    };
  }

  // Atomically claim the cooldown window *before* doing any trigger work. The
  // claim is a single UPDATE serialized on the user's row, so a concurrent
  // wakeup that reaches this point at the same instant loses the claim and is
  // skipped instead of double-firing against Google.
  const { data: claimed, error: claimError } = await supabase.rpc(
    "claim_wakeup_run",
    { p_clerk_user_id: clerkUserId },
  );

  if (claimError) {
    console.error("Failed to claim wakeup run:", claimError);
    return {
      clerkUserId,
      results: [],
      skipped: true,
      skipReason: "Failed to claim wakeup run",
    };
  }

  if (!claimed) {
    return {
      clerkUserId,
      results: [],
      skipped: true,
      skipReason: "On cooldown",
    };
  }

  const triggerSource: TriggerSource = options?.asBackgroundJob
    ? "scheduled"
    : "manual";

  // Log after each account rather than one batch at the end: a platform kill
  // mid-run (serverless duration limit) then preserves history for every
  // account that already completed instead of erasing the whole run.
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
    await logTriggerResults(clerkUserId, results, triggerSource);
  }

  return {
    clerkUserId,
    results: allResults,
    skipped: false,
  };
}
