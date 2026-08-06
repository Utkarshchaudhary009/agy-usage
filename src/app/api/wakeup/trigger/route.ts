import { auth } from "@clerk/nextjs/server";
import { type NextRequest, NextResponse } from "next/server";
import { unauthorized } from "@/lib/api/accounts";
import { createServerClient } from "@/lib/supabase/server";
import { acquireWakeupLock, releaseWakeupLock } from "@/lib/wakeup/lock";
import { requireJsonRequest } from "@/lib/wakeup/request";
import {
  executeWakeup,
  triggerSingleModel,
} from "@/lib/wakeup/trigger-service";

function alreadyRunningResponse() {
  return NextResponse.json(
    {
      error: "Conflict",
      code: "ALREADY_RUNNING",
      message:
        "A wakeup is already running for this account. Try again shortly.",
    },
    { status: 409 },
  );
}

interface SingleTriggerBody {
  accountId: string;
  modelId: string;
}

function isSingleTriggerBody(body: unknown): body is SingleTriggerBody {
  if (typeof body !== "object" || body === null) return false;
  const b = body as Record<string, unknown>;
  return (
    typeof b.accountId === "string" &&
    typeof b.modelId === "string" &&
    b.accountId.length > 0 &&
    b.modelId.length > 0
  );
}

export async function POST(req: NextRequest) {
  const { userId } = await auth();
  if (!userId) return unauthorized();

  const parsed = await requireJsonRequest(req);
  if (!parsed.ok) return parsed.response;

  const supabase = await createServerClient();

  if (isSingleTriggerBody(parsed.body)) {
    // A manual single trigger must not run concurrently with an in-flight
    // `executeWakeup` for the same user: two simultaneous runs would both call
    // Google for overlapping accounts/models. Take the same per-user lease
    // `executeWakeup` uses so only one of them proceeds. (The full-wakeup
    // branch below does NOT take the lock here — `executeWakeup` acquires it
    // itself, and the lease is not reentrant.)
    const lock = await acquireWakeupLock(userId);
    if (!lock.granted) {
      return alreadyRunningResponse();
    }

    try {
      const result = await triggerSingleModel(
        parsed.body.accountId,
        parsed.body.modelId,
        "hi",
        1,
        userId,
        supabase,
        "manual",
      );

      return NextResponse.json({ result });
    } finally {
      await releaseWakeupLock(userId, lock.lockToken);
    }
  }

  const result = await executeWakeup(userId, "manual");

  return NextResponse.json(result);
}
