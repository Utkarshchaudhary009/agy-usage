import { auth } from "@clerk/nextjs/server";
import { type NextRequest, NextResponse } from "next/server";
import { internalError, unauthorized } from "@/lib/api/responses";
import { createServerClient } from "@/lib/supabase/server";
import {
  DEFAULT_WAKEUP_CONFIG,
  dbConfigToWakeup,
  type WakeupConfig,
  wakeupConfigToDb,
} from "@/lib/types/wakeup";
import { validateWakeupConfig } from "@/lib/wakeup/config-schema";

// Per-user configuration: never let a shared cache or CDN retain it.
const NO_STORE = { "Cache-Control": "no-store" } as const;

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

  return NextResponse.json({ config }, { headers: NO_STORE });
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
      { status: 400, headers: NO_STORE },
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
      { status: 400, headers: NO_STORE },
    );
  }

  const supabase = await createServerClient();
  const { config } = validation;

  // Reject account selections that don't belong to this user. The database
  // enforces this too (trigger `wakeup_configs_validate_accounts`, migration
  // 010) because the browser can reach PostgREST directly and skip this route;
  // checking here just fails fast with a clear message.
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
        { status: 400, headers: NO_STORE },
      );
    }
  }

  // `clerk_user_id` is the UNIQUE key for a config, but it is not the primary
  // key. Without an explicit conflict target PostgREST defaults to the primary
  // key (`id`), which we never send, so every save after the first would insert
  // a new row and trip the unique violation instead of updating.
  const { data, error } = await supabase
    .from("wakeup_configs")
    .upsert(wakeupConfigToDb(config, userId), { onConflict: "clerk_user_id" })
    .select()
    .single();

  if (error) return internalError("save wakeup config", error);

  return NextResponse.json(
    { config: dbConfigToWakeup(data) },
    { headers: NO_STORE },
  );
}
