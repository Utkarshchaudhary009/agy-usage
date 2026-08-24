import "server-only";
import { auth } from "@clerk/nextjs/server";
import { type NextRequest, NextResponse } from "next/server";
import { errorJson, internalError, unauthorized } from "@/lib/api/accounts";
import { createServerClient } from "@/lib/supabase/server";
import { getWakeupConfig, saveWakeupConfig } from "@/lib/wakeup/config";

export async function GET() {
  const { userId } = await auth();
  if (!userId) return unauthorized();

  try {
    const supabase = await createServerClient();
    const config = await getWakeupConfig(supabase, userId);
    return NextResponse.json({ config });
  } catch (err) {
    return internalError("load wakeup config", err);
  }
}

export async function PUT(req: NextRequest) {
  const { userId } = await auth();
  if (!userId) return unauthorized();

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return errorJson(
      {
        error: "Bad Request",
        code: "INVALID_JSON",
        message: "Request body must be valid JSON.",
      },
      400,
    );
  }

  try {
    const supabase = await createServerClient();

    const { data: accounts, error: accountsError } = await supabase
      .from("google_accounts")
      .select("id")
      .eq("clerk_user_id", userId);

    if (accountsError) {
      return internalError("load accounts", accountsError);
    }

    const ownedAccountIds = new Set((accounts ?? []).map((a) => a.id));
    const result = await saveWakeupConfig(
      supabase,
      userId,
      body,
      ownedAccountIds,
    );

    if (!result.ok) {
      return errorJson(
        {
          error: result.error,
          code: result.code,
          message: "Could not save your wakeup configuration.",
        },
        400,
      );
    }

    return NextResponse.json({ config: result.config });
  } catch (err) {
    return internalError("save wakeup config", err);
  }
}
