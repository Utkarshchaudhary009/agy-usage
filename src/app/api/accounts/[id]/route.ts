import { auth } from "@clerk/nextjs/server";
import { type NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase/server";

type RouteContext = { params: Promise<{ id: string }> };

function unauthorized() {
  return NextResponse.json(
    {
      error: "Unauthorized",
      code: "UNAUTHORIZED",
      message: "You must be logged in to manage accounts.",
    },
    { status: 401 },
  );
}

function notFound() {
  return NextResponse.json(
    {
      error: "Not Found",
      code: "ACCOUNT_NOT_FOUND",
      message: "Account not found or you don't have permission to access it.",
    },
    { status: 404 },
  );
}

async function getOwnedAccountId(
  supabase: Awaited<ReturnType<typeof createServerClient>>,
  userId: string,
  id: string,
) {
  const { data, error } = await supabase
    .from("google_accounts")
    .select("id")
    .eq("id", id)
    .eq("clerk_user_id", userId)
    .single();

  return { data, error };
}

function internalError(action: string, cause?: unknown) {
  console.error(`Failed to ${action} account:`, cause);
  return NextResponse.json(
    {
      error: "Internal Server Error",
      code: "INTERNAL_ERROR",
      message: `Failed to ${action} account`,
    },
    { status: 500 },
  );
}

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
  if (lookupError) return internalError("update", lookupError);
  if (!account) return notFound();

  // Single atomic RPC: activates this account and deactivates the rest.
  const { error } = await supabase.rpc("set_active_account", {
    p_account_id: id,
  });

  if (error) return internalError("update", error);

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
  if (lookupError) return internalError("remove", lookupError);
  if (!account) return notFound();

  // Permanently removes the account, its tokens, vault secrets, and quota cache.
  const { error } = await supabase.rpc("delete_account_with_tokens", {
    p_account_id: id,
  });

  if (error) return internalError("remove", error);

  return NextResponse.json({ success: true });
}
