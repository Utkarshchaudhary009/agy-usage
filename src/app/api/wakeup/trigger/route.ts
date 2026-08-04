import { auth } from "@clerk/nextjs/server";
import { type NextRequest, NextResponse } from "next/server";
import {
  accountNotFound,
  errorJson,
  getOwnedAccountId,
  internalError,
  isRowNotFound,
  unauthorized,
} from "@/lib/api/accounts";
import { createServerClient } from "@/lib/supabase/server";
import { isOnCooldown } from "@/lib/wakeup/cooldown";
import {
  executeWakeup,
  triggerSingleModel,
} from "@/lib/wakeup/trigger-service";

export async function POST(req: NextRequest) {
  const { userId } = await auth();
  if (!userId) {
    return unauthorized();
  }

  const body = await req.json().catch(() => ({}));
  const accountId = body.accountId as string | undefined;
  const modelId = body.modelId as string | undefined;

  if (accountId && modelId) {
    const supabase = await createServerClient();
    const { data: account, error: lookupError } = await getOwnedAccountId(
      supabase,
      userId,
      accountId,
    );
    if (lookupError && !isRowNotFound(lookupError)) {
      return internalError("trigger wakeup", lookupError);
    }
    if (!account) return accountNotFound();

    const onCooldown = await isOnCooldown(userId);
    if (onCooldown) {
      return errorJson(
        {
          error: "Cooldown Active",
          code: "COOLDOWN_ACTIVE",
          message:
            "Wakeup is on cooldown. Please wait before triggering again.",
        },
        429,
      );
    }

    const result = await triggerSingleModel(accountId, modelId, "hi", 1);

    return NextResponse.json({
      success: result.success,
      durationMs: result.durationMs,
      error: result.error ?? null,
    });
  }

  const supabase = await createServerClient();
  const { data: config, error: configError } = await supabase
    .from("wakeup_configs")
    .select("clerk_user_id")
    .eq("clerk_user_id", userId)
    .single();

  if (configError && !isRowNotFound(configError)) {
    return internalError("trigger wakeup", configError);
  }
  if (!config) {
    return errorJson(
      {
        error: "No Wakeup Config",
        code: "NO_WAKEUP_CONFIG",
        message:
          "No wakeup configuration found. Please configure wakeup in settings.",
      },
      404,
    );
  }

  const onCooldown = await isOnCooldown(userId);
  if (onCooldown) {
    return errorJson(
      {
        error: "Cooldown Active",
        code: "COOLDOWN_ACTIVE",
        message: "Wakeup is on cooldown. Please wait before triggering again.",
      },
      429,
    );
  }

  const result = await executeWakeup(userId);

  return NextResponse.json({
    success: result.success,
    totalDurationMs: result.totalDurationMs,
    results: result.results,
  });
}
