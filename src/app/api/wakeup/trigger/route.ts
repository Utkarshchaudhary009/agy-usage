import "server-only";
import { auth } from "@clerk/nextjs/server";
import { type NextRequest, NextResponse } from "next/server";
import { errorJson, internalError, unauthorized } from "@/lib/api/accounts";
import { enforceRateLimit } from "@/lib/api/rate-limit";
import { createServerClient } from "@/lib/supabase/server";
import { isUuid } from "@/lib/utils";
import { getWakeupConfig } from "@/lib/wakeup/config";
import { isWakeupModelId } from "@/lib/wakeup/models";
import {
  executeWakeup,
  triggerSingleModel,
} from "@/lib/wakeup/trigger-service";

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

  let body: { accountId?: string; modelId?: string } = {};
  try {
    body = await req.json();
  } catch {
    // Body is optional
  }

  try {
    if (body.accountId && body.modelId) {
      if (!isUuid(body.accountId)) {
        return errorJson(
          {
            error: "Invalid account ID.",
            code: "INVALID_ACCOUNT",
            message: "Invalid account ID.",
          },
          400,
        );
      }
      if (!isWakeupModelId(body.modelId)) {
        return errorJson(
          {
            error: "Invalid model ID.",
            code: "INVALID_MODEL",
            message: "Invalid model ID.",
          },
          400,
        );
      }

      const supabase = await createServerClient();
      const { data: account, error: accountError } = await supabase
        .from("google_accounts")
        .select("id")
        .eq("id", body.accountId)
        .eq("clerk_user_id", userId)
        .single();

      if (accountError || !account) {
        return errorJson(
          {
            error: "Not Found",
            code: "ACCOUNT_NOT_FOUND",
            message:
              "Account not found or you don't have permission to access it.",
          },
          404,
        );
      }

      const config = await getWakeupConfig(supabase, userId);

      const result = await triggerSingleModel(
        body.accountId,
        body.modelId,
        config?.customPrompt ?? "hi",
        config?.maxOutputTokens ?? 1,
      );

      await supabase.from("wakeup_logs").insert({
        clerk_user_id: userId,
        account_id: result.accountId,
        model_id: result.modelId,
        trigger_source: "manual",
        success: result.success,
        duration_ms: result.durationMs,
        error: result.error || null,
        response_preview: result.responsePreview || null,
      });

      return NextResponse.json({
        clerkUserId: userId,
        results: [result],
        skipped: false,
      });
    }

    const result = await executeWakeup(userId);
    return NextResponse.json(result);
  } catch (err) {
    return internalError("execute wakeup", err);
  }
}
