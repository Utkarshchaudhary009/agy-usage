import { auth } from "@clerk/nextjs/server";
import { type NextRequest, NextResponse } from "next/server";
import { errorJson, internalError, unauthorized } from "@/lib/api/accounts";
import { createServerClient } from "@/lib/supabase/server";
import { isUuid } from "@/lib/utils";
import { isWakeupModelId } from "@/lib/wakeup/models";
import {
  executeWakeup,
  triggerSingleModel,
} from "@/lib/wakeup/trigger-service";

export async function POST(req: NextRequest) {
  const { userId } = await auth();
  if (!userId) return unauthorized();

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

      const result = await triggerSingleModel(
        body.accountId,
        body.modelId,
        "hi",
        1,
      );

      const logSupabase = await createServerClient();
      await logSupabase.from("wakeup_logs").insert({
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
