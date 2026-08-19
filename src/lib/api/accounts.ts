import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  type ApiErrorBody,
  errorJson,
  internalError,
  isRowNotFound,
  unauthorized,
} from "@/lib/api/errors";
import type { Database } from "@/lib/types/database";

export {
  errorJson,
  internalError,
  isRowNotFound,
  type ApiErrorBody,
  unauthorized,
};

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
