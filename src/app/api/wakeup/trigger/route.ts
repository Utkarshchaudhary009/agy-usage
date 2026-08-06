import { auth } from "@clerk/nextjs/server";
import { type NextRequest, NextResponse } from "next/server";
import { unauthorized } from "@/lib/api/accounts";
import { createServerClient } from "@/lib/supabase/server";
import { requireJsonRequest } from "@/lib/wakeup/request";
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

  const parsed = await requireJsonRequest(req);
  if (!parsed.ok) return parsed.response;

  const supabase = await createServerClient();

  if (isSingleTriggerBody(parsed.body)) {
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
  }

  const result = await executeWakeup(userId, "manual");

  return NextResponse.json(result);
}
