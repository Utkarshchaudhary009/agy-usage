import { auth } from "@clerk/nextjs/server";
import { type NextRequest, NextResponse } from "next/server";
import { unauthorized } from "@/lib/api/accounts";
import { createServerClient } from "@/lib/supabase/server";
import {
  buildDefaultConfig,
  getWakeupConfig,
  parseWakeupInput,
  saveWakeupConfig,
  validateWakeupInput,
} from "@/lib/wakeup/config";

const FALLBACKS = {
  intervalHours: 6,
  maxOutputTokens: 1,
  cooldownMinutes: 60,
} as const;

export async function GET() {
  const { userId } = await auth();
  if (!userId) return unauthorized();

  const supabase = await createServerClient();
  const config = await getWakeupConfig(supabase, userId);

  return NextResponse.json({
    config: config ?? buildDefaultConfig(userId),
    isDefault: config === null,
  });
}

export async function PUT(req: NextRequest) {
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

  const input = parseWakeupInput(body);
  const { valid, errors } = validateWakeupInput(input);

  if (!valid) {
    return NextResponse.json(
      {
        error: "Validation Error",
        code: "VALIDATION_ERROR",
        message: "One or more fields are invalid.",
        fieldErrors: errors,
      },
      { status: 422 },
    );
  }

  const supabase = await createServerClient();
  const { config, error } = await saveWakeupConfig(supabase, userId, input);

  if (error) {
    return NextResponse.json(
      {
        error: "Internal Server Error",
        code: "SAVE_FAILED",
        message: "Could not save wakeup configuration.",
      },
      { status: 500 },
    );
  }

  return NextResponse.json({
    config,
    appliedFallbacks: {
      intervalHours: input.intervalHours || FALLBACKS.intervalHours,
      maxOutputTokens: input.maxOutputTokens || FALLBACKS.maxOutputTokens,
      cooldownMinutes: input.cooldownMinutes || FALLBACKS.cooldownMinutes,
    },
  });
}
