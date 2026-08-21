import { auth } from "@clerk/nextjs/server";
import { type NextRequest, NextResponse } from "next/server";
import {
  accountNotFound,
  internalError,
  isRowNotFound,
  unauthorized,
} from "@/lib/api/accounts";
import { createServerClient } from "@/lib/supabase/server";
import {
  DEFAULT_WAKEUP_CONFIG,
  UUID_RE,
  WAKEUP_MODEL_IDS,
} from "@/lib/types/wakeup";
import { beginWakeup, getCooldownRemainingMs } from "@/lib/wakeup/cooldown";
import {
  executeWakeup,
  triggerSingleModel,
} from "@/lib/wakeup/trigger-service";

type TriggerBody = {
  accountId?: string;
  modelId?: string;
};

function badRequest(message: string) {
  return NextResponse.json(
    {
      error: "Bad Request",
      code: "INVALID_INPUT",
      message,
    },
    { status: 400 },
  );
}

function cooldownResponse(remainingMs: number) {
  return NextResponse.json(
    {
      error: "Cooldown",
      code: "COOLDOWN",
      message: "Wakeup is on cooldown. Try again shortly.",
      retryAfterMs: remainingMs,
    },
    {
      status: 429,
      headers: {
        "Retry-After": String(Math.max(1, Math.ceil(remainingMs / 1000))),
      },
    },
  );
}

// Reads the raw body and parses it into a TriggerBody, distinguishing an empty
// body (a valid full-wakeup request) from malformed JSON (a client error that
// must be rejected rather than silently treated as a full wakeup).
async function parseTriggerBody(req: NextRequest): Promise<{
  body: TriggerBody;
  error?: NextResponse;
}> {
  const raw = await req.text();
  if (raw.trim().length === 0) {
    return { body: {} };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { body: {}, error: badRequest("Invalid JSON body.") };
  }

  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return {
      body: {},
      error: badRequest("Request body must be a JSON object."),
    };
  }

  return { body: parsed as TriggerBody };
}

export async function POST(req: NextRequest) {
  const { userId } = await auth();
  if (!userId) return unauthorized();

  const { body, error } = await parseTriggerBody(req);
  if (error) return error;

  const hasAccount =
    typeof body.accountId === "string" && body.accountId.length > 0;
  const hasModel = typeof body.modelId === "string" && body.modelId.length > 0;

  // Single-model, single-account trigger.
  if (hasAccount && hasModel) {
    const accountId = body.accountId as string;
    const modelId = body.modelId as string;

    if (!UUID_RE.test(accountId)) {
      return badRequest("accountId must be a valid UUID.");
    }
    if (!WAKEUP_MODEL_IDS.includes(modelId)) {
      return badRequest("modelId is not an allowed model.");
    }

    // Apply the same atomic per-user cooldown as the full wakeup so a manual
    // single-model trigger cannot be used to bypass the throttle.
    let cooldownRemaining: number;
    try {
      cooldownRemaining = await getCooldownRemainingMs(userId);
    } catch {
      return internalError("compute cooldown");
    }
    if (cooldownRemaining > 0) {
      return cooldownResponse(cooldownRemaining);
    }
    if (!(await beginWakeup(userId))) {
      const remaining = await getCooldownRemainingMs(userId).catch(
        () => cooldownRemaining,
      );
      return cooldownResponse(remaining);
    }

    const supabase = await createServerClient();
    const { data: account, error: lookupError } = await supabase
      .from("google_accounts")
      .select("id, clerk_user_id")
      .eq("id", accountId)
      .eq("clerk_user_id", userId)
      .single();

    if (lookupError && !isRowNotFound(lookupError)) {
      return internalError("lookup account", lookupError);
    }
    if (!account) return accountNotFound();

    const { data: config, error: configError } = await supabase
      .from("wakeup_configs")
      .select("custom_prompt, max_output_tokens")
      .eq("clerk_user_id", userId)
      .maybeSingle();

    if (configError) {
      return internalError("load wakeup config", configError);
    }

    const result = await triggerSingleModel(
      accountId,
      modelId,
      config?.custom_prompt ?? DEFAULT_WAKEUP_CONFIG.customPrompt,
      config?.max_output_tokens ?? DEFAULT_WAKEUP_CONFIG.maxOutputTokens,
      { clerkUserId: userId, triggerSource: "manual" },
    );

    return NextResponse.json({ result });
  }

  // A partial single-trigger request (exactly one of accountId/modelId) is
  // malformed: require both fields together, otherwise reject.
  if (hasAccount || hasModel) {
    return badRequest(
      "Both accountId and modelId are required for a single-model trigger.",
    );
  }

  // Full wakeup for the current user (respects cooldown). This is only a fast
  // pre-check; the atomic gate in executeWakeup() is what actually enforces it.
  let cooldownRemaining: number;
  try {
    cooldownRemaining = await getCooldownRemainingMs(userId);
  } catch {
    return internalError("compute cooldown");
  }
  if (cooldownRemaining > 0) {
    return cooldownResponse(cooldownRemaining);
  }

  const result = await executeWakeup(userId, { triggerSource: "manual" });

  if (!result.triggered && result.skippedReason) {
    if (result.skippedReason === "cooldown") {
      const remaining = await getCooldownRemainingMs(userId).catch(
        () => cooldownRemaining,
      );
      return cooldownResponse(remaining);
    }

    // disabled / no_config / no_models / no_accounts are legitimate "nothing
    // to do" states rather than errors.
    return NextResponse.json({
      skipped: true,
      reason: result.skippedReason,
      result,
    });
  }

  return NextResponse.json({ result });
}
