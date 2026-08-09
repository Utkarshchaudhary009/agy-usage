import { auth } from "@clerk/nextjs/server";
import { type NextRequest, NextResponse } from "next/server";
import { internalError, unauthorized } from "@/lib/api/accounts";
import { createServerClient } from "@/lib/supabase/server";
import {
  DEFAULT_WAKEUP_CONFIG,
  dbConfigToWakeup,
  validateWakeupConfig,
  type WakeupConfig,
  wakeupConfigToDb,
} from "@/lib/types/wakeup";

export async function GET() {
  const { userId } = await auth();
  if (!userId) return unauthorized();

  const supabase = await createServerClient();
  const { data, error } = await supabase
    .from("wakeup_configs")
    .select("*")
    .eq("clerk_user_id", userId)
    .maybeSingle();

  if (error) return internalError("load wakeup config", error);

  const config: WakeupConfig = data
    ? dbConfigToWakeup(data)
    : DEFAULT_WAKEUP_CONFIG;

  return NextResponse.json({ config });
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
        message: "Request body is not valid JSON.",
      },
      { status: 400 },
    );
  }

  const validation = validateWakeupConfig(body);
  if (!validation.ok) {
    return NextResponse.json(
      {
        error: "Validation Error",
        code: "VALIDATION_ERROR",
        message: validation.error,
      },
      { status: 400 },
    );
  }

  const supabase = await createServerClient();
  const { config } = validation;

  // Reject account selections that don't belong to this user (RLS would also
  // block the upsert, but we fail fast with a clear message).
  if (config.selectedAccountIds.length > 0) {
    const { data: owned, error: ownedError } = await supabase
      .from("google_accounts")
      .select("id")
      .eq("clerk_user_id", userId);

    if (ownedError) return internalError("verify accounts", ownedError);

    const ownedIds = new Set((owned ?? []).map((a) => a.id));
    const invalid = config.selectedAccountIds.filter((id) => !ownedIds.has(id));
    if (invalid.length > 0) {
      return NextResponse.json(
        {
          error: "Bad Request",
          code: "ACCOUNT_NOT_FOUND",
          message:
            "One or more selected accounts are invalid or not linked to your account.",
        },
        { status: 400 },
      );
    }
  }

  const { data, error } = await supabase
    .from("wakeup_configs")
    .upsert(wakeupConfigToDb(config, userId))
    .select()
    .single();

  if (error) return internalError("save wakeup config", error);

  return NextResponse.json({ config: dbConfigToWakeup(data) });
}
