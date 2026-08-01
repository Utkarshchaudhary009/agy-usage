import { auth } from "@clerk/nextjs/server";
import { type NextRequest, NextResponse } from "next/server";
import {
  accountNotFound,
  getOwnedAccountId,
  internalError,
  isRowNotFound,
  unauthorized,
} from "@/lib/api/accounts";
import { createServerClient } from "@/lib/supabase/server";

type RouteContext = { params: Promise<{ id: string }> };

export async function PATCH(_req: NextRequest, { params }: RouteContext) {
  const { userId } = await auth();
  if (!userId) return unauthorized();

  const { id } = await params;

  const supabase = await createServerClient();
  const { data: account, error: lookupError } = await getOwnedAccountId(
    supabase,
    userId,
    id,
  );
  // PGRST116 = no rows matched after RLS filtering: a genuine not-found.
  if (lookupError && !isRowNotFound(lookupError)) {
    return internalError("update account", lookupError);
  }
  if (!account) return accountNotFound();

  // Single atomic RPC: activates this account and deactivates the rest.
  const { error } = await supabase.rpc("set_active_account", {
    p_account_id: id,
  });

  if (error) return internalError("update account", error);

  return NextResponse.json({ success: true });
}

export async function DELETE(_req: NextRequest, { params }: RouteContext) {
  const { userId } = await auth();
  if (!userId) return unauthorized();

  const { id } = await params;

  const supabase = await createServerClient();
  const { data: account, error: lookupError } = await getOwnedAccountId(
    supabase,
    userId,
    id,
  );
  // PGRST116 = no rows matched after RLS filtering: a genuine not-found.
  if (lookupError && !isRowNotFound(lookupError)) {
    return internalError("remove account", lookupError);
  }
  if (!account) return accountNotFound();

  // Permanently removes the account, its tokens, vault secrets, and quota cache.
  const { error } = await supabase.rpc("delete_account_with_tokens", {
    p_account_id: id,
  });

  if (error) return internalError("remove account", error);

  return NextResponse.json({ success: true });
}
