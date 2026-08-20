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

  const hasAccountId =
    typeof body === "object" && body !== null && "accountId" in body;
  const hasModelId =
    typeof body === "object" && body !== null && "modelId" in body;

  // A payload that names only one of accountId/modelId is malformed. Treat it
  // as a client error rather than silently falling through to a bulk run that
  // would trigger the caller's entire saved configuration.
  if (hasAccountId !== hasModelId) {
    return NextResponse.json(
      {
        error: "Bad Request",
        code: "MISSING_PARAMS",
        message:
          "Both accountId and modelId are required for specific triggers.",
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

  let handledByExecute = false;
  let loggedOk = true;

  try {
    if (hasAccountId && hasModelId) {
      const { accountId, modelId, prompt, maxOutputTokens } = body as {
        accountId?: string;
        modelId?: string;
        prompt?: unknown;
        maxOutputTokens?: unknown;
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

      const safePrompt =
        typeof prompt === "string" && prompt.length > 0
          ? prompt.slice(0, 4000)
          : "hi";
      const safeMaxTokens =
        typeof maxOutputTokens === "number" && maxOutputTokens > 0
          ? Math.floor(maxOutputTokens)
          : 1;

      let result: TriggerResult;
      try {
        result = await triggerSingleModel(
          accountId,
          modelId,
          safePrompt,
          safeMaxTokens,
        );
      } catch (err) {
        // A failed trigger still must not leave the cooldown reservation
        // dangling; release it (the failure is already surfaced below).
        loggedOk = false;
        throw err;
      }

      // Persist the real log row (replacing the reserved slot) so the cooldown
      // is now based on the actual trigger time. If logging fails we deliberately
      // keep the reservation so the cooldown is still enforced.
      loggedOk = await logTrigger(
        userId,
        accountId,
        result.modelId,
        "manual",
        result.success,
        result.durationMs,
        result.error,
      );

      return NextResponse.json({
        success: result.success,
        modelId: result.modelId,
        durationMs: result.durationMs,
        error: result.error,
      });
    } else {
      handledByExecute = true;
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
  } finally {
    // Release the reservation on every path that did not delegate to
    // executeWakeup (which releases it itself), and only when the real log was
    // persisted so a logging failure still enforces the cooldown.
    if (attempt.attemptId && !handledByExecute && loggedOk) {
      await endWakeupAttempt(attempt.attemptId);
    }
  }
}
