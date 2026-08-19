import { auth } from "@clerk/nextjs/server";
import { type NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase/server";
import {
  configToInsert,
  loadWakeupConfig,
  validateWakeupConfig,
} from "@/lib/wakeup/config";

export async function GET() {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json(
      {
        error: "Unauthorized",
        code: "UNAUTHORIZED",
        message: "You must be logged in to view wakeup config.",
      },
      { status: 401 },
    );
  }

  try {
    const supabase = await createServerClient();
    const config = await loadWakeupConfig(supabase, userId);
    return NextResponse.json({ config });
  } catch (error) {
    console.error("Wakeup config GET error:", error);
    return NextResponse.json(
      {
        error: "Internal Server Error",
        code: "INTERNAL_ERROR",
        message: "Failed to load wakeup configuration.",
      },
      { status: 500 },
    );
  }
}

export async function PUT(req: NextRequest) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json(
      {
        error: "Unauthorized",
        code: "UNAUTHORIZED",
        message: "You must be logged in to update wakeup config.",
      },
      { status: 401 },
    );
  }

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

  try {
    const supabase = await createServerClient();

    // Resolve the account ids the user actually owns so we can reject any
    // selected account id that does not belong to them.
    const { data: accounts, error: accountsError } = await supabase
      .from("google_accounts")
      .select("id")
      .eq("clerk_user_id", userId);

    if (accountsError) {
      console.error(
        "Failed to load accounts for config update:",
        accountsError,
      );
      return NextResponse.json(
        {
          error: "Internal Server Error",
          code: "INTERNAL_ERROR",
          message: "Failed to load your accounts.",
        },
        { status: 500 },
      );
    }

    const ownedAccountIds = new Set((accounts ?? []).map((a) => a.id));
    const result = validateWakeupConfig(body, ownedAccountIds);
    if (!result.valid || !result.config) {
      return NextResponse.json(
        {
          error: "Validation Error",
          code: "VALIDATION_ERROR",
          message: result.error ?? "Invalid configuration.",
        },
        { status: 400 },
      );
    }

    // Upsert keyed by clerk_user_id (UNIQUE) so repeated saves update the row.
    const { error: upsertError } = await supabase
      .from("wakeup_configs")
      .upsert(configToInsert(result.config, userId), {
        onConflict: "clerk_user_id",
      });

    if (upsertError) {
      console.error("Failed to save wakeup config:", upsertError);
      return NextResponse.json(
        {
          error: "Internal Server Error",
          code: "INTERNAL_ERROR",
          message: "Failed to save wakeup configuration.",
        },
        { status: 500 },
      );
    }

    return NextResponse.json({ config: result.config });
  } catch (error) {
    console.error("Wakeup config PUT error:", error);
    return NextResponse.json(
      {
        error: "Internal Server Error",
        code: "INTERNAL_ERROR",
        message: "Failed to save wakeup configuration.",
      },
      { status: 500 },
    );
  }
}
