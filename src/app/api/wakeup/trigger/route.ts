import { auth } from "@clerk/nextjs/server";
import { type NextRequest, NextResponse } from "next/server";
import { internalError, unauthorized } from "@/lib/api/accounts";
import { isOnCooldown } from "@/lib/wakeup/cooldown";
import {
  executeWakeup,
  triggerSingleModel,
} from "@/lib/wakeup/trigger-service";

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

  const cooldownInfo = await isOnCooldown(userId);
  if (cooldownInfo.onCooldown) {
    return NextResponse.json(
      {
        error: "Too Many Requests",
        code: "WAKEUP_ON_COOLDOWN",
        message: "Wakeup is on cooldown. Please try again later.",
        nextAllowedAt: cooldownInfo.nextAllowedAt,
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

      const result = await triggerSingleModel(
        accountId,
        modelId,
        prompt || "hi",
        maxOutputTokens || 1,
      );

      return NextResponse.json({
        success: result.success,
        modelId: result.modelId,
        durationMs: result.durationMs,
        error: result.error,
      });
    } else {
      const result = await executeWakeup(userId);

      return NextResponse.json({
        success: result.success,
        totalModels: result.totalModels,
        successfulTriggers: result.successfulTriggers,
        failedTriggers: result.failedTriggers,
        results: result.results,
        nextAllowedAt: result.nextAllowedAt,
        error: result.error,
      });
    }
  } catch (err) {
    return internalError("wakeup trigger", err);
  }
}
