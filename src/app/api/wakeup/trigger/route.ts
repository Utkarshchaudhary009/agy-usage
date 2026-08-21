import { auth } from "@clerk/nextjs/server";
import { type NextRequest, NextResponse } from "next/server";
import {
  accountNotFound,
  internalError,
  isRowNotFound,
  unauthorized,
} from "@/lib/api/accounts";
import { createServerClient } from "@/lib/supabase/server";
import { UUID_RE, WAKEUP_MODEL_IDS } from "@/lib/types/wakeup";
import { getCooldownRemainingMs } from "@/lib/wakeup/cooldown";
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

export async function POST(req: NextRequest) {
  const { userId } = await auth();
  if (!userId) return unauthorized();

  let body: TriggerBody = {};
  try {
    const parsed = await req.json();
    if (parsed && typeof parsed === "object") {
      body = parsed as TriggerBody;
    }
  } catch {
    body = {};
  }

  // Single-model, single-account trigger.
  if (body.accountId && body.modelId) {
    // Validate inputs before any external call or lookup.
    if (typeof body.accountId !== "string" || !UUID_RE.test(body.accountId)) {
      return badRequest("accountId must be a valid UUID.");
    }
    if (
      typeof body.modelId !== "string" ||
      !WAKEUP_MODEL_IDS.includes(body.modelId)
    ) {
      return badRequest("modelId is not an allowed model.");
    }

    const supabase = await createServerClient();
    const { data: account, error: lookupError } = await supabase
      .from("google_accounts")
      .select("id, clerk_user_id")
      .eq("id", body.accountId)
      .eq("clerk_user_id", userId)
      .single();

    if (lookupError && !isRowNotFound(lookupError)) {
      return internalError("lookup account", lookupError);
    }
    if (!account) return accountNotFound();

    const { data: config } = await supabase
      .from("wakeup_configs")
      .select("custom_prompt, max_output_tokens")
      .eq("clerk_user_id", userId)
      .maybeSingle();

    const result = await triggerSingleModel(
      body.accountId,
      body.modelId,
      config?.custom_prompt ?? "hi",
      config?.max_output_tokens ?? 1,
      { clerkUserId: userId, triggerSource: "manual" },
    );

    return NextResponse.json({ result });
  }

  // Full wakeup for the current user (respects cooldown).
  const cooldownRemaining = await getCooldownRemainingMs(userId);
  if (cooldownRemaining > 0) {
    return NextResponse.json(
      {
        error: "Cooldown",
        code: "COOLDOWN",
        message: "Wakeup is on cooldown. Try again shortly.",
        retryAfterMs: cooldownRemaining,
      },
      {
        status: 429,
        headers: {
          "Retry-After": String(Math.ceil(cooldownRemaining / 1000)),
        },
      },
    );
  }

  const result = await executeWakeup(userId, { triggerSource: "manual" });

  if (!result.triggered && result.skippedReason) {
    if (result.skippedReason === "cooldown") {
      return NextResponse.json(
        {
          error: "Cooldown",
          code: "COOLDOWN",
          message: "Wakeup is on cooldown.",
          skipped: true,
          reason: result.skippedReason,
        },
        { status: 429 },
      );
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
