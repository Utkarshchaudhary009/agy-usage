import { auth } from "@clerk/nextjs/server";
import { type NextRequest, NextResponse } from "next/server";
import { unauthorized } from "@/lib/api/accounts";
import { createServerClient } from "@/lib/supabase/server";
import {
  assertOwnedAccountIds,
  buildDefaultConfig,
  getWakeupConfig,
  parseWakeupInput,
  saveWakeupConfig,
  validateWakeupInput,
} from "@/lib/wakeup/config";
import { requireJsonRequest } from "@/lib/wakeup/request";

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

  const parsed = await requireJsonRequest(req);
  if (!parsed.ok) return parsed.response;

  const input = parseWakeupInput(parsed.body);
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

  // Account ids are attacker-controlled; never persist ids the caller does
  // not own, even though the scheduler re-filters by owner at run time.
  const ownership = await assertOwnedAccountIds(
    supabase,
    userId,
    input.selectedAccountIds,
  );
  if (!ownership.ok) {
    return NextResponse.json(
      {
        error: "Validation Error",
        code: "VALIDATION_ERROR",
        message: "One or more fields are invalid.",
        fieldErrors: { selectedAccountIds: ownership.error },
      },
      { status: 422 },
    );
  }

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

  return NextResponse.json({ config });
}
