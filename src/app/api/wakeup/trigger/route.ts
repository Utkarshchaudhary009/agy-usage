import { auth } from "@clerk/nextjs/server";
import { type NextRequest, NextResponse } from "next/server";
import {
  accountNotFound,
  errorJson,
  internalError,
  unauthorized,
} from "@/lib/api/accounts";
import { enforceRateLimit } from "@/lib/api/rate-limit";
import { createServerClient } from "@/lib/supabase/server";
import { isUuid } from "@/lib/utils";
import { defaultWakeupConfig, isWakeupModelId } from "@/lib/wakeup/models";
import {
  executeWakeup,
  logTriggerResults,
  triggerSingleModel,
} from "@/lib/wakeup/trigger-service";

// A full run is sequential: each account/model pairing costs up to ~15s
// (stream timeout) plus a 1s inter-model pause, so a default config (3 models)
// fits comfortably within this budget while larger selections may exceed it.
// executeWakeup logs per account as it goes, so even a platform kill at the
// duration limit preserves history for accounts that already completed; long
// multi-account runs belong on the scheduled Inngest path instead.
export const maxDuration = 60;

interface TriggerBody {
  accountId?: string;
  modelId?: string;
}

function isTriggerBody(value: unknown): value is TriggerBody {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const raw = value as Record<string, unknown>;
  const accountIdOk =
    raw.accountId === undefined ||
    raw.accountId === null ||
    typeof raw.accountId === "string";
  const modelIdOk =
    raw.modelId === undefined ||
    raw.modelId === null ||
    typeof raw.modelId === "string";
  return accountIdOk && modelIdOk;
}

export async function POST(req: NextRequest) {
  const { userId } = await auth();
  if (!userId) return unauthorized();

  // This endpoint reaches Google for every targeted account/model, so it is
  // rate limited before any upstream work happens.
  const limited = await enforceRateLimit({
    bucket: "wakeup_trigger",
    identifier: userId,
    limit: 20,
    window: "1 h",
    message: "Too many wakeup triggers. Please wait before triggering again.",
  });
  if (limited) return limited;

  // An absent body means "run my full wakeup config"; malformed JSON is
  // rejected so a buggy client cannot accidentally order an expensive run.
  const text = await req.text();
  let body: TriggerBody = {};
  if (text.trim().length > 0) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      return validationFailed("Request body must be valid JSON.");
    }
    if (!isTriggerBody(parsed)) {
      return validationFailed(
        "Request body must be an object with optional accountId and modelId strings.",
      );
    }
    body = parsed;
  }

  try {
    if (body.accountId || body.modelId) {
      return await triggerSingle(body, userId);
    }

    const result = await executeWakeup(userId);
    return NextResponse.json(result);
  } catch (err) {
    return internalError("execute wakeup", err);
  }
}

/**
 * Targeted single-account/model trigger ("test this model now"). Deliberately
 * bypasses the cooldown window — its purpose is verifying one pairing works —
 * but still logs through the service role like every other trigger.
 */
async function triggerSingle(
  body: TriggerBody,
  userId: string,
): Promise<NextResponse> {
  if (!isUuid(body.accountId)) {
    return validationFailed("accountId must be a valid account ID.");
  }
  if (!isWakeupModelId(body.modelId)) {
    return validationFailed("modelId must be a supported wakeup model.");
  }

  const supabase = await createServerClient();

  const { data: account, error: accountError } = await supabase
    .from("google_accounts")
    .select("id")
    .eq("id", body.accountId)
    .eq("clerk_user_id", userId)
    .single();

  if (accountError || !account) return accountNotFound();

  // Prompt and token cap come from the user's saved config so the test fires
  // exactly what a scheduled run would; documented defaults apply when no
  // config has been saved yet.
  const defaults = defaultWakeupConfig();
  const { data: row, error: configError } = await supabase
    .from("wakeup_configs")
    .select("custom_prompt, max_output_tokens")
    .eq("clerk_user_id", userId)
    .maybeSingle();

  if (configError) return internalError("load wakeup config", configError);

  const result = await triggerSingleModel(
    body.accountId,
    body.modelId,
    row?.custom_prompt ?? defaults.customPrompt,
    row?.max_output_tokens ?? defaults.maxOutputTokens,
  );

  await logTriggerResults(userId, [result], "manual");

  return NextResponse.json({
    clerkUserId: userId,
    results: [result],
    skipped: false,
  });
}

function validationFailed(message: string) {
  return errorJson(
    {
      error: "Bad Request",
      code: "VALIDATION_ERROR",
      message,
    },
    400,
  );
}
