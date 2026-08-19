import { auth } from "@clerk/nextjs/server";
import { type NextRequest, NextResponse } from "next/server";
import {
  badRequest,
  internalError,
  unauthorized,
  validationError,
} from "@/lib/api/errors";
import { createServerClient } from "@/lib/supabase/server";
import {
  configToInsert,
  loadWakeupConfig,
  validateWakeupConfig,
} from "@/lib/wakeup/config";

export async function GET() {
  const { userId } = await auth();
  if (!userId) {
    return unauthorized("You must be logged in to view wakeup config.");
  }

  try {
    const supabase = await createServerClient();
    const config = await loadWakeupConfig(supabase, userId);
    return NextResponse.json({ config });
  } catch (error) {
    return internalError("load wakeup configuration", error);
  }
}

export async function PUT(req: NextRequest) {
  const { userId } = await auth();
  if (!userId) {
    return unauthorized("You must be logged in to update wakeup config.");
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return badRequest("INVALID_JSON", "Request body must be valid JSON.");
  }

  try {
    const supabase = await createServerClient();

    // Resolve the account ids the user actually owns so we can reject any
    // selected account id that does not belong to them.
    const { data: accounts, error: accountsError } = await supabase
      .from("google_accounts")
      .select("id")
      .eq("clerk_user_id", userId);

    if (accountsError) {
      return internalError("load your accounts", accountsError);
    }

    const ownedAccountIds = new Set((accounts ?? []).map((a) => a.id));
    const result = validateWakeupConfig(body, ownedAccountIds);
    if (!result.valid || !result.config) {
      return validationError(result.error ?? "Invalid configuration.");
    }

    // Upsert keyed by clerk_user_id (UNIQUE) so repeated saves update the row.
    const { error: upsertError } = await supabase
      .from("wakeup_configs")
      .upsert(configToInsert(result.config, userId), {
        onConflict: "clerk_user_id",
      });

    if (upsertError) {
      return internalError("save wakeup configuration", upsertError);
    }

    return NextResponse.json({ config: result.config });
  } catch (error) {
    return internalError("save wakeup configuration", error);
  }
}
