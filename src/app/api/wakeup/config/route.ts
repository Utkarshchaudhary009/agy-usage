import { auth } from "@clerk/nextjs/server";
import { type NextRequest, NextResponse } from "next/server";
import { findUnlinkedAccountIds } from "@/lib/api/accounts";
import { badRequest, internalError, unauthorized } from "@/lib/api/responses";
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

  if (error) return internalError("load wakeup config", error, NO_STORE);

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
    return badRequest(
      "INVALID_JSON",
      "Request body is not valid JSON.",
      NO_STORE,
    );
  }

  const validation = validateWakeupConfig(body);
  if (!validation.ok) {
    return badRequest("VALIDATION_ERROR", validation.error, NO_STORE);
  }

  const supabase = await createServerClient();
  const { config } = validation;

  // Reject account selections that don't belong to this user. The database
  // enforces this too (trigger `wakeup_configs_validate_accounts`, migration
  // 010) because the browser can reach PostgREST directly and skip this route;
  // checking here just fails fast with a clear message.
  if (config.selectedAccountIds.length > 0) {
    let invalid: string[];
    try {
      invalid = await findUnlinkedAccountIds(
        supabase,
        userId,
        config.selectedAccountIds,
      );
    } catch (err) {
      return internalError("verify accounts", err, NO_STORE);
    }

    if (invalid.length > 0) {
      return badRequest(
        "ACCOUNT_NOT_FOUND",
        "One or more selected accounts are invalid or not linked to your account.",
        NO_STORE,
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

  if (error) {
    // 23514 = check_violation. The wakeup_configs_validate_accounts trigger
    // (migration 010) rejects any selected_account_ids entry that no longer
    // belongs to the user — e.g. an account deleted between our ownership check
    // and this upsert. Surface it as a clean 400 rather than a generic 500.
    if (error.code === "23514") {
      return badRequest(
        "ACCOUNT_NOT_FOUND",
        "One or more selected accounts are invalid or not linked to your account.",
        NO_STORE,
      );
    }
    return internalError("save wakeup config", error, NO_STORE);
  }

  return NextResponse.json(
    { config: dbConfigToWakeup(data) },
    { headers: NO_STORE },
  );
}
