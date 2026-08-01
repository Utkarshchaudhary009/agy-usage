import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { AccountList } from "@/components/accounts/account-list";
import { Skeleton } from "@/components/ui/skeleton";
import { createServerClient } from "@/lib/supabase/server";
import type { LinkedAccount } from "@/lib/types/account";
import type { QuotaSnapshot } from "@/lib/types/quota";

const ERROR_MESSAGES: Record<string, string> = {
  missing_parameters:
    "Google did not return the required parameters. Please try again.",
  missing_cookie: "Your OAuth session expired. Please try again.",
  invalid_cookie: "Your OAuth session was invalid. Please try again.",
  state_mismatch: "OAuth state verification failed. Please try again.",
  token_exchange_failed:
    "Google rejected the authorization code. Please try again.",
  profile_fetch_failed:
    "Could not fetch your Google profile. Please try again.",
  account_lookup_failed:
    "Could not check for an existing account. Please try again.",
  account_update_failed: "Could not update your account. Please try again.",
  account_count_failed:
    "Could not check your existing accounts. Please try again.",
  account_creation_failed: "Could not create your account. Please try again.",
  missing_refresh_token:
    "Google did not return a refresh token. Try a different account or check your Google permissions.",
  token_save_failed: "Could not securely save your tokens. Please try again.",
  unexpected_error:
    "An unexpected error occurred while linking your account. Please try again.",
};

const SKELETON_KEYS = [0, 1, 2];

function AccountsSkeleton() {
  return (
    <div className="flex flex-col gap-6">
      <div className="flex justify-between items-center">
        <Skeleton className="h-5 w-32" />
        <Skeleton className="h-8 w-36" />
      </div>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {SKELETON_KEYS.map((key) => (
          <div
            key={key}
            className="space-y-3 rounded-xl bg-card p-4 ring-1 ring-foreground/10"
          >
            <div className="flex items-center gap-3">
              <Skeleton className="h-10 w-10 rounded-full" />
              <div className="space-y-2">
                <Skeleton className="h-4 w-40" />
                <Skeleton className="h-3 w-24" />
              </div>
            </div>
            <Skeleton className="h-3 w-full" />
            <Skeleton className="h-8 w-2/3" />
          </div>
        ))}
      </div>
    </div>
  );
}

async function AccountsLoader({
  userId,
  errorKey,
  successKey,
}: {
  userId: string;
  errorKey?: string;
  successKey?: string;
}) {
  const supabase = await createServerClient();

  const { data: rows, error: rowsError } = await supabase
    .from("google_accounts")
    .select(
      "id, email, display_name, is_active, token_status, added_at, last_used_at",
    )
    .eq("clerk_user_id", userId)
    .order("added_at", { ascending: true });

  if (rowsError) {
    console.error("Failed to load accounts:", rowsError);
    return (
      <AccountList
        accounts={[]}
        errorMessage="Could not load your accounts. Please try again."
        successMessage={null}
        loadFailed
      />
    );
  }

  const accounts = rows ?? [];

  // Fetch cached quota snapshots in a single query (RLS scopes to this user).
  const { data: cacheRows, error: cacheError } = accounts.length
    ? await supabase
        .from("quota_cache")
        .select("account_id, snapshot")
        .in(
          "account_id",
          accounts.map((a) => a.id),
        )
    : { data: null, error: null };

  if (cacheError) {
    // Quota display is supplementary; log and continue with no snapshots.
    console.error("Failed to load quota snapshots:", cacheError);
  }

  const snapshotByAccount = new Map<string, QuotaSnapshot>();
  for (const row of cacheRows ?? []) {
    const snapshot = row.snapshot as unknown as QuotaSnapshot | null;
    // Guard against stale/malformed cached shapes crashing the client.
    if (
      !snapshot ||
      typeof snapshot !== "object" ||
      !Array.isArray(snapshot.models)
    ) {
      continue;
    }
    snapshotByAccount.set(row.account_id, snapshot);
  }

  const linkedAccounts: LinkedAccount[] = accounts.map((row) => ({
    id: row.id,
    email: row.email,
    displayName: row.display_name,
    isActive: row.is_active,
    tokenStatus: row.token_status,
    addedAt: row.added_at,
    lastUsedAt: row.last_used_at,
    quota: snapshotByAccount.get(row.id) ?? null,
  }));

  const errorMessage = errorKey
    ? (ERROR_MESSAGES[errorKey] ?? ERROR_MESSAGES.unexpected_error)
    : null;
  const successMessage =
    successKey === "account_linked"
      ? "Google account linked successfully."
      : null;

  return (
    <AccountList
      accounts={linkedAccounts}
      errorMessage={errorMessage}
      successMessage={successMessage}
    />
  );
}

export default async function AccountsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[]>>;
}) {
  const { userId } = await auth();

  if (!userId) {
    redirect("/sign-in");
  }

  const params = await searchParams;
  const errorKey = typeof params.error === "string" ? params.error : undefined;
  const successKey =
    typeof params.success === "string" ? params.success : undefined;

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-bold tracking-tight">Accounts</h1>
      <Suspense fallback={<AccountsSkeleton />}>
        <AccountsLoader
          userId={userId}
          errorKey={errorKey}
          successKey={successKey}
        />
      </Suspense>
    </div>
  );
}
