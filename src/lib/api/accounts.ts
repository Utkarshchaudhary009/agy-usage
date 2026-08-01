import "server-only";
import type { PostgrestError, SupabaseClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import type { Database } from "@/lib/types/database";

const ROW_NOT_FOUND_CODE = "PGRST116";

export interface ApiErrorBody {
  error: string;
  code: string;
  message: string;
}

// PGRST116 = no rows matched, either because the row does not exist or RLS
// filtered it out. Both cases are a genuine not-found to the caller.
export function isRowNotFound(
  error: PostgrestError | null | undefined,
): boolean {
  return error?.code === ROW_NOT_FOUND_CODE;
}

export function errorJson(
  body: ApiErrorBody,
  status: number,
  headers?: Record<string, string>,
) {
  return NextResponse.json(body, { status, headers });
}

export function unauthorized() {
  return errorJson(
    {
      error: "Unauthorized",
      code: "UNAUTHORIZED",
      message: "You must be logged in to manage accounts.",
    },
    401,
  );
}

export function accountNotFound() {
  return errorJson(
    {
      error: "Not Found",
      code: "ACCOUNT_NOT_FOUND",
      message: "Account not found or you don't have permission to access it.",
    },
    404,
  );
}

export function internalError(action: string, cause?: unknown) {
  console.error(`Failed to ${action}:`, cause);
  return errorJson(
    {
      error: "Internal Server Error",
      code: "INTERNAL_ERROR",
      message: `Failed to ${action}`,
    },
    500,
  );
}

// Fetches the id of the account owned by the given user. Returns null when the
// account does not exist or RLS filtered it out. The client is passed in so a
// route only ever creates one Supabase client per request.
export async function getOwnedAccountId(
  supabase: SupabaseClient<Database>,
  userId: string,
  id: string,
) {
  return supabase
    .from("google_accounts")
    .select("id")
    .eq("id", id)
    .eq("clerk_user_id", userId)
    .single();
}
