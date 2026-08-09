import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { accountNotFound, getOwnedAccountId } from "@/lib/api/responses";
import type { Database } from "@/lib/types/database";

export { accountNotFound, getOwnedAccountId };

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
