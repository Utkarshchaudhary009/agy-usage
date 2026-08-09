import "server-only";
import type { PostgrestError, SupabaseClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import type { Database } from "@/lib/types/database";

const ROW_NOT_FOUND_CODE = "PGRST116";

/** The error envelope every API route returns (see AGENTS.md). */
export interface ApiErrorBody {
  error: string;
  code: string;
  message: string;
}

export type ResponseHeaders = Record<string, string>;

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
  headers?: ResponseHeaders,
) {
  return NextResponse.json(body, { status, headers });
}

export function unauthorized(headers?: ResponseHeaders) {
  return errorJson(
    {
      error: "Unauthorized",
      code: "UNAUTHORIZED",
      message: "You must be signed in to perform this action.",
    },
    401,
    headers,
  );
}

export function badRequest(
  code: string,
  message: string,
  headers?: ResponseHeaders,
) {
  return errorJson({ error: "Bad Request", code, message }, 400, headers);
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

export function internalError(
  action: string,
  cause?: unknown,
  headers?: ResponseHeaders,
) {
  console.error(`Failed to ${action}:`, cause);
  return errorJson(
    {
      error: "Internal Server Error",
      code: "INTERNAL_ERROR",
      message: `Failed to ${action}`,
    },
    500,
    headers,
  );
}

export function getOwnedAccountId(
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

// Returns the subset of `accountIds` that the user does not own. The query is
// bounded by the requested ids instead of listing every account the user has.
export async function findUnlinkedAccountIds(
  supabase: SupabaseClient<Database>,
  userId: string,
  accountIds: string[],
): Promise<string[]> {
  if (accountIds.length === 0) return [];

  const { data, error } = await supabase
    .from("google_accounts")
    .select("id")
    .eq("clerk_user_id", userId)
    .in("id", accountIds);

  if (error) throw error;

  const owned = new Set((data ?? []).map((row) => row.id));
  return accountIds.filter((id) => !owned.has(id));
}
