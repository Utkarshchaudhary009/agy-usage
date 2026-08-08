import { auth } from "@clerk/nextjs/server";
import { type NextRequest, NextResponse } from "next/server";
import { internalError, unauthorized } from "@/lib/api/accounts";
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
      const result = await triggerSingleModel(
        body.accountId,
        body.modelId,
        "hi",
        1,
      );

      const supabase = (
        await import("@/lib/supabase/server")
      ).createServiceClient();
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
