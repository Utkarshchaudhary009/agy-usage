import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { streamGenerateContent } from "@/lib/google/cloudcode-client";
import { resolveProjectId } from "@/lib/google/project-resolver";
import { getValidAccessToken } from "@/lib/google/token-manager";
import { createServerClient, createServiceClient } from "@/lib/supabase/server";
import type { Database } from "@/lib/types/database";
import type { TriggerAllResult, TriggerSingleResult } from "@/lib/types/wakeup";
import { getWakeupConfig } from "./config";

// A single wakeup run expands into one upstream Google request per (account,
// model) pair. That multiplication is an amplification primitive: a config of
// 50 accounts x 20 models would otherwise issue 1000 upstream requests every
// time its schedule fires. Cap the number of upstream requests a single run may
// perform so no user — manual or scheduled — can blow the upstream budget in
// one shot. The manual endpoint's per-user rate limit bounds how often a run
// starts; this bounds how much a single run does. When the projected expansion
// exceeds the budget we trim the most expensive dimension (accounts) and keep
// every requested model, since waking the models is the point of the feature.
const MAX_WAKEUP_REQUESTS_PER_RUN = 200;

// Upstream error messages can transitively carry credential material — Google
// sometimes echoes a request's `Authorization` header or a token-bearing URL
// back in an error body, and the token-refresh path can surface the token
// endpoint URL. These strings are persisted verbatim to the user-readable
// `wakeup_logs.error` column and also returned in the trigger response, so we
// redact anything that looks like a secret before it leaves this module.
const SECRET_PATTERNS = [
  /\bBearer\s+[A-Za-z0-9._~-]+/gi,
  /\baccess_token[=:]\s*[^\s,"}]+/gi,
  /\brefresh_token[=:]\s*[^\s,"}]+/gi,
  /\bclient_secret[=:]\s*[^\s,"}]+/gi,
  /\bAuthorization[=:]\s*[^\s,"}]+/gi,
  /\b[A-Za-z0-9_-]{32,}\.[A-Za-z0-9_-]{32,}/g, // JWT / dot-delimited secrets
] as const;

function scrubSecret(value: string): string {
  let out = value;
  for (const re of SECRET_PATTERNS) {
    out = out.replace(re, "[REDACTED]");
  }
  return out;
}

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
    const raw = err instanceof Error ? err.message : String(err);
    error = scrubSecret(raw).slice(0, 2000);
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

  // An empty selection means "all of my linked accounts" (per the config UI).
  // Resolve them here (cheap read) before claiming the cooldown window, so a
  // no-op run with no target accounts never stamps a cooldown.
  let targetAccountIds =
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

  // Bound the upstream work this run will perform (see
  // MAX_WAKEUP_REQUESTS_PER_RUN). Trim excess accounts rather than dropping
  // models so the configured wake targets are still all exercised.
  const projectedRequests =
    targetAccountIds.length * config.selectedModels.length;
  if (projectedRequests > MAX_WAKEUP_REQUESTS_PER_RUN) {
    const maxAccounts = Math.max(
      1,
      Math.floor(MAX_WAKEUP_REQUESTS_PER_RUN / config.selectedModels.length),
    );
    if (targetAccountIds.length > maxAccounts) {
      console.warn(
        `Wakeup for user ${clerkUserId} would issue ${projectedRequests} ` +
          `upstream requests, exceeding the per-run budget of ` +
          `${MAX_WAKEUP_REQUESTS_PER_RUN}; trimming ${targetAccountIds.length} ` +
          `accounts to ${maxAccounts}.`,
      );
      targetAccountIds = targetAccountIds.slice(0, maxAccounts);
    }
  }

  // Atomically claim the cooldown window *before* doing any trigger work. The
  // claim is a single UPDATE serialized on the user's row, so a concurrent
  // wakeup (a manual trigger racing the scheduled Inngest run) that reaches this
  // point at the same instant loses the claim and is skipped instead of
  // double-firing against Google. The window is anchored to last_run_started_at,
  // which is stamped by the claim itself — not by the log row written at the end
  // of the run — so an in-flight run correctly blocks re-entry.
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
