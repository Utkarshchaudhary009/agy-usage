import { auth } from "@clerk/nextjs/server";
import { type NextRequest, NextResponse } from "next/server";
import { internalError, unauthorized } from "@/lib/api/accounts";
import { createServerClient } from "@/lib/supabase/server";
import { WAKEUP_MODELS, type WakeupModelOption } from "@/lib/types/wakeup";
import { beginWakeupAttempt, endWakeupAttempt } from "@/lib/wakeup/cooldown";
import {
  executeWakeup,
  logTrigger,
  type TriggerResult,
  triggerSingleModel,
} from "@/lib/wakeup/trigger-service";

const KNOWN_MODEL_IDS = new Set<string>(
  WAKEUP_MODELS.map((m: WakeupModelOption) => m.id),
);

export async function POST(request: NextRequest) {
  const { userId } = await auth();
  if (!userId) return unauthorized();

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      {
        error: "Bad Request",
        code: "INVALID_JSON",
        message: "Request body must be valid JSON.",
      },
      { status: 400 },
    );
  }

  // Atomically claim the cooldown slot before doing any work. This closes the
  // check-then-act race where two overlapping requests could both pass a simple
  // cooldown read and fire. `beginWakeupAttempt` serializes per user and
  // reserves the slot up front.
  const attempt = await beginWakeupAttempt(userId);
  if (!attempt.allowed) {
    return NextResponse.json(
      {
        error: "Too Many Requests",
        code: "WAKEUP_ON_COOLDOWN",
        message: "Wakeup is on cooldown. Please try again later.",
        nextAllowedAt: attempt.nextAllowedAt,
      },
      { status: 429 },
    );
  }

  const hasAccountId = typeof body === "object" && body && "accountId" in body;
  const hasModelId = typeof body === "object" && body && "modelId" in body;

  try {
    if (hasAccountId && hasModelId) {
      const { accountId, modelId, prompt, maxOutputTokens } = body as {
        accountId?: string;
        modelId?: string;
        prompt?: string;
        maxOutputTokens?: number;
      };

      if (!accountId || !modelId) {
        return NextResponse.json(
          {
            error: "Bad Request",
            code: "MISSING_PARAMS",
            message:
              "accountId and modelId are required for specific triggers.",
          },
          { status: 400 },
        );
      }

      if (!KNOWN_MODEL_IDS.has(modelId)) {
        return NextResponse.json(
          {
            error: "Bad Request",
            code: "INVALID_MODEL",
            message: "Unknown model identifier.",
          },
          { status: 400 },
        );
      }

      // Enforce ownership: the requested account must belong to the
      // authenticated user. Without this check the untrusted accountId would
      // reach the token resolver for an arbitrary account (IDOR).
      const supabase = await createServerClient();
      const { data: owned, error: ownError } = await supabase
        .from("google_accounts")
        .select("id")
        .eq("id", accountId)
        .eq("clerk_user_id", userId)
        .maybeSingle();

      if (ownError) {
        return internalError("verify account ownership", ownError);
      }
      if (!owned) {
        return NextResponse.json(
          {
            error: "Forbidden",
            code: "ACCOUNT_NOT_OWNED",
            message: "The requested account does not belong to this user.",
          },
          { status: 403 },
        );
      }

      const safePrompt = (prompt ?? "hi").slice(0, 4000);

      let result: TriggerResult;
      try {
        result = await triggerSingleModel(
          accountId,
          modelId,
          safePrompt,
          maxOutputTokens || 1,
        );

        // Persist the real log row (replacing the reserved slot) so the cooldown
        // is now based on the actual trigger time.
        await logTrigger(
          userId,
          accountId,
          result.modelId,
          "manual",
          result.success,
          result.durationMs,
          result.error,
        );
      } finally {
        // Always release the reservation, even if logging/trigger failed.
        if (attempt.attemptId) {
          await endWakeupAttempt(attempt.attemptId);
        }
      }

      return NextResponse.json({
        success: result.success,
        modelId: result.modelId,
        durationMs: result.durationMs,
        error: result.error,
      });
    } else {
      const result = await executeWakeup(userId, attempt.attemptId);

      return NextResponse.json({
        success: result.success,
        totalModels: result.totalModels,
        successfulTriggers: result.successfulTriggers,
        failedTriggers: result.failedTriggers,
        results: result.results,
        nextAllowedAt: attempt.nextAllowedAt,
        error: result.error,
      });
    }
  } catch (err) {
    return internalError("wakeup trigger", err);
  }
}
