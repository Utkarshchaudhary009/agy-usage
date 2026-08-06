import { auth } from "@clerk/nextjs/server";
import { type NextRequest, NextResponse } from "next/server";
import { unauthorized } from "@/lib/api/accounts";
import { createServerClient } from "@/lib/supabase/server";
import {
  executeWakeup,
  triggerSingleModel,
} from "@/lib/wakeup/trigger-service";

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

  let body: unknown;
  try {
    body = await req.json();
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

  const supabase = await createServerClient();

  if (isSingleTriggerBody(body)) {
    const result = await triggerSingleModel(
      body.accountId,
      body.modelId,
      "hi",
      1,
      userId,
      supabase,
      "manual",
    );

    return NextResponse.json({ result });
  }

  const result = await executeWakeup(userId, "manual");

  return NextResponse.json(result);
}
