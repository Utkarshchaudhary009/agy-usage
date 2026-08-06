import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { streamGenerateContent } from "@/lib/google/cloudcode-client";
import {
  CloudCodeAuthError,
  CloudCodeRateLimitError,
  CloudCodeServerError,
} from "@/lib/google/errors";
import { resolveProjectId } from "@/lib/google/project-resolver";
import {
  getValidAccessToken,
  TokenRefreshError,
  TokenRefreshTimeoutError,
} from "@/lib/google/token-manager";
import { createServerClient } from "@/lib/supabase/server";
import type { Database } from "@/lib/types/database";
import {
  isKnownWakeupModel,
  type TriggerSource,
  WAKEUP_LIMITS,
} from "@/lib/types/wakeup";
import { getWakeupConfig } from "./config";
import { isOnCooldown } from "./cooldown";
import {
  acquireWakeupLock,
  estimateWakeupLeaseSeconds,
  releaseWakeupLock,
  renewWakeupLock,
} from "./lock";

const CONCURRENT_RUN_SKIPPED: WakeupResult = {
  success: true,
  triggeredModels: 0,
  failedModels: 0,
  results: [],
  cooldownSkipped: true,
};

/**
 * Client-safe failure reasons.
 *
 * Upstream errors (Google API bodies, Postgres/Vault messages, token-manager
 * diagnostics) are logged and persisted server-side but never returned to the
 * browser — they can carry internal identifiers and infrastructure detail.
 */
export type TriggerErrorCode =
  | "ACCOUNT_NOT_FOUND"
  | "INVALID_MODEL"
  | "TOKEN_REFRESH_FAILED"
  | "RATE_LIMITED"
  | "UPSTREAM_ERROR"
  | "TIMEOUT"
  | "UNKNOWN";

const ERROR_MESSAGES: Record<TriggerErrorCode, string> = {
  ACCOUNT_NOT_FOUND:
    "Account not found or you don't have permission to use it.",
  INVALID_MODEL: "Unknown model.",
  TOKEN_REFRESH_FAILED:
    "Google rejected the stored credentials. Please re-authenticate this account.",
  RATE_LIMITED: "Google rate limited this request. Try again shortly.",
  UPSTREAM_ERROR: "Google's API could not be reached.",
  TIMEOUT: "The wakeup request timed out.",
  UNKNOWN: "The wakeup request failed.",
};

export interface TriggerResult {
  success: boolean;
  durationMs: number;
  /** Stable, non-sensitive failure reason. */
  errorCode?: TriggerErrorCode;
  /** Human-readable text derived from `errorCode` — safe to display. */
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

// biome-ignore lint/suspicious/noControlCharactersInRegex: collapsing control characters is exactly the intent
const CONTROL_CHARS_RE = /[\u0000-\u001f\u007f-\u009f]+/g;

/**
 * Verifies that `accountId` is a Google account owned by `clerkUserId`.
 *
 * This is the security boundary for the whole wakeup engine. Everything below
 * runs with `asBackgroundJob: true`, which uses the service-role Supabase
 * client and therefore bypasses RLS *and* the ownership checks inside the
 * token RPCs. Without this gate, any authenticated caller who can name another
 * tenant's account UUID would be able to mint that tenant's Google access
 * token, spend their model quota, and read the model's reply.
 *
 * The check runs on every trigger rather than once per batch: it is a single
 * indexed lookup next to a multi-second network call, and making it
 * unconditional means no future caller can forget it.
 */
async function isOwnedAccount(
  supabase: SupabaseClient<Database>,
  clerkUserId: string,
  accountId: string,
): Promise<boolean> {
  const { data, error } = await supabase
    .from("google_accounts")
    .select("id")
    .eq("id", accountId)
    .eq("clerk_user_id", clerkUserId)
    .maybeSingle();

  if (error) {
    console.error("Failed to verify wakeup account ownership:", error);
    return false;
  }

  return data !== null;
}

function classifyError(err: unknown): TriggerErrorCode {
  if (err instanceof TokenRefreshTimeoutError) return "TIMEOUT";
  if (err instanceof TokenRefreshError) return "TOKEN_REFRESH_FAILED";
  if (err instanceof CloudCodeAuthError) return "TOKEN_REFRESH_FAILED";
  if (err instanceof CloudCodeRateLimitError) return "RATE_LIMITED";
  if (err instanceof CloudCodeServerError) return "UPSTREAM_ERROR";
  if (
    err instanceof Error &&
    (err.name === "AbortError" || err.name === "TimeoutError")
  ) {
    return "TIMEOUT";
  }
  return "UNKNOWN";
}

function sanitize(text: string, maxLength: number): string {
  return text.replace(CONTROL_CHARS_RE, " ").slice(0, maxLength).trim();
}

function failure(
  accountId: string,
  modelId: string,
  durationMs: number,
  errorCode: TriggerErrorCode,
): TriggerResult {
  return {
    success: false,
    durationMs,
    errorCode,
    error: ERROR_MESSAGES[errorCode],
    modelId,
    accountId,
  };
}

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

  // Only allowlisted models are ever sent to Google — `modelId` can come
  // straight from a request body or from a stored (possibly stale) config row.
  if (!isKnownWakeupModel(modelId)) {
    return failure(accountId, modelId, 0, "INVALID_MODEL");
  }

  if (!(await isOwnedAccount(supabase, clerkUserId, accountId))) {
    console.warn(
      `Rejected wakeup trigger for unowned account by user ${clerkUserId}`,
    );
    // Not logged to wakeup_logs: the row would reference an account the caller
    // does not own.
    return failure(
      accountId,
      modelId,
      Date.now() - startTime,
      "ACCOUNT_NOT_FOUND",
    );
  }

  const safePrompt = sanitize(prompt, WAKEUP_LIMITS.maxPromptLength) || "hi";
  const safeMaxTokens = Math.min(
    Math.max(
      Math.trunc(maxTokens) || WAKEUP_LIMITS.minOutputTokens,
      WAKEUP_LIMITS.minOutputTokens,
    ),
    WAKEUP_LIMITS.maxOutputTokens,
  );

  // One deadline for the whole trigger. The signal is threaded into the Cloud
  // Code client so a stalled or endlessly-retried upstream call actually
  // unwinds instead of holding the request open.
  const controller = new AbortController();
  const timeoutId = setTimeout(() => {
    const reason = new Error("Wakeup trigger deadline exceeded");
    reason.name = "AbortError";
    controller.abort(reason);
  }, TRIGGER_TIMEOUT_MS);

  let result: TriggerResult;

  try {
    const accessToken = await getValidAccessToken(accountId, {
      asBackgroundJob: true,
    });

    const projectId = await resolveProjectId(accountId, {
      asBackgroundJob: true,
    });

    const response = await streamGenerateContent(
      accessToken,
      accountId,
      projectId,
      modelId,
      safePrompt,
      safeMaxTokens,
      { signal: controller.signal },
    );

    result = {
      success: true,
      durationMs: Date.now() - startTime,
      modelId,
      accountId,
      responsePreview: sanitize(response.text, PREVIEW_MAX_LENGTH),
    };
  } catch (err) {
    const errorCode = controller.signal.aborted
      ? "TIMEOUT"
      : classifyError(err);

    // Full detail stays server-side.
    console.error("Wakeup trigger failed:", {
      accountId,
      modelId,
      errorCode,
      error: err instanceof Error ? err.message : String(err),
    });

    result = failure(accountId, modelId, Date.now() - startTime, errorCode);
  } finally {
    clearTimeout(timeoutId);
  }

  await logWakeupResult(supabase, clerkUserId, result, triggerSource);
  return result;
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
      error: result.errorCode
        ? sanitize(
            `${result.errorCode}: ${result.error ?? ""}`,
            WAKEUP_LIMITS.maxStoredErrorLength,
          )
        : null,
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
  // Serialize per user. The cooldown check below is a read that only "commits"
  // when the trigger finishes and writes a log, so without a lock two runs for
  // the same user (a manual trigger + a scheduled one, or two scheduled retries
  // emitted by the Inngest fan-out) can both pass the check and both call
  // Google. The lease spans the whole read -> trigger -> log sequence. See
  // migration 010.
  const lock = await acquireWakeupLock(clerkUserId);
  if (!lock.granted) {
    return CONCURRENT_RUN_SKIPPED;
  }

  const supabase = await createServerClient();

  try {
    // `getWakeupConfig` is the single read boundary for wakeup config and already
    // applies the model allowlist, so `selectedModels` here is always safe to send
    // to Google.
    const wakeupConfig = await getWakeupConfig(supabase, clerkUserId);

    if (
      !wakeupConfig ||
      !wakeupConfig.enabled ||
      wakeupConfig.selectedModels.length === 0
    ) {
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

    // Cover the real fan-out rather than the base TTL: if the lease expires
    // mid-run a second execution could start and double-trigger.
    const leaseSecs = estimateWakeupLeaseSeconds(
      accounts.length,
      wakeupConfig.selectedModels.length,
    );
    if (!renewWakeupLock(clerkUserId, lock.lockToken, leaseSecs)) {
      return CONCURRENT_RUN_SKIPPED;
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
  } finally {
    await releaseWakeupLock(clerkUserId, lock.lockToken);
  }
}
