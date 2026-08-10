import { auth } from "@clerk/nextjs/server";
import { type NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase/server";
import {
  AccountOwnershipError,
  getWakeupConfig,
  isPostgrestError,
  saveWakeupConfig,
  validateWakeupInput,
} from "@/lib/wakeup/config";

function unauthorized() {
  return NextResponse.json(
    {
      error: "Unauthorized",
      code: "UNAUTHORIZED",
      message: "You must be logged in to manage wakeup settings.",
    },
    { status: 401 },
  );
}

export async function GET() {
  const { userId } = await auth();
  if (!userId) return unauthorized();

  try {
    const supabase = await createServerClient();
    const config = await getWakeupConfig(supabase, userId);
    return NextResponse.json({ config });
  } catch (err) {
    console.error("Wakeup config load error:", err);
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

  const validation = validateWakeupInput(body);
  if (!validation.valid || !validation.data) {
    return NextResponse.json(
      {
        error: "Validation Error",
        code: "VALIDATION_ERROR",
        message: "One or more fields are invalid.",
        fields: validation.errors,
      },
      { status: 400 },
    );
  }

  try {
    const supabase = await createServerClient();
    const config = await saveWakeupConfig(supabase, validation.data);
    return NextResponse.json({ config });
  } catch (err) {
    if (err instanceof AccountOwnershipError) {
      return NextResponse.json(
        {
          error: "Forbidden",
          code: "ACCOUNT_FORBIDDEN",
          message: err.message,
        },
        { status: 403 },
      );
    }
    if (isPostgrestError(err)) {
      console.error("Wakeup config save PostgrestError:", {
        code: err.code,
        details: err.details,
        hint: err.hint,
        message: err.message,
      });
    } else {
      console.error("Wakeup config save error:", err);
    }
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
