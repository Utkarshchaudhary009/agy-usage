import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { WakeupConfigForm } from "@/components/wakeup/config-form";
import { createServerClient } from "@/lib/supabase/server";
import {
  WAKEUP_MODEL_IDS,
  type WakeupAccountOption,
  type WakeupConfig,
} from "@/lib/types/wakeup";
import { getWakeupConfig } from "@/lib/wakeup/config-service";

const ALLOWED_MODEL_IDS = new Set<string>(WAKEUP_MODEL_IDS);

function WakeupSkeleton() {
  return (
    <div className="flex flex-col gap-6">
      <div className="space-y-3 rounded-xl bg-card p-4 ring-1 ring-foreground/10">
        <Skeleton className="h-5 w-48" />
        <Skeleton className="h-3 w-72 max-w-full" />
        <Skeleton className="h-14 w-full" />
      </div>
      <div className="grid gap-6 lg:grid-cols-2">
        {["models", "accounts"].map((key) => (
          <div
            key={key}
            className="space-y-3 rounded-xl bg-card p-4 ring-1 ring-foreground/10"
          >
            <Skeleton className="h-5 w-32" />
            <Skeleton className="h-3 w-56 max-w-full" />
            <Skeleton className="h-24 w-full" />
          </div>
        ))}
      </div>
      {["schedule", "details"].map((key) => (
        <div
          key={key}
          className="space-y-3 rounded-xl bg-card p-4 ring-1 ring-foreground/10"
        >
          <Skeleton className="h-5 w-40" />
          <Skeleton className="h-3 w-64 max-w-full" />
          <Skeleton className="h-32 w-full" />
        </div>
      ))}
      <div className="flex justify-end gap-2 border-t pt-4">
        <Skeleton className="h-8 w-24" />
        <Skeleton className="h-8 w-32" />
      </div>
    </div>
  );
}

function LoadFailed() {
  return (
    <div className="flex flex-col items-center justify-center rounded-lg border bg-card p-8 text-center min-h-[400px]">
      <h2 className="mb-2 text-2xl font-semibold">Something went wrong</h2>
      <p className="max-w-md text-muted-foreground">
        We could not load your wakeup settings. Please try again in a moment.
      </p>
    </div>
  );
}

/**
 * Drops selections the UI cannot display any more (an account was unlinked, a
 * model was retired). Without this the form would keep submitting an id that
 * no checkbox can clear, and every save would fail.
 */
function pruneUnavailableSelections(
  config: WakeupConfig,
  accounts: WakeupAccountOption[],
  accountsLoadFailed: boolean,
): WakeupConfig {
  const accountIds = new Set(accounts.map((account) => account.id));

  return {
    ...config,
    selectedModels: config.selectedModels.filter((id) =>
      ALLOWED_MODEL_IDS.has(id),
    ),
    // When the account list itself failed to load, everything would look
    // unavailable, so the stored selection is left untouched.
    selectedAccountIds: accountsLoadFailed
      ? config.selectedAccountIds
      : config.selectedAccountIds.filter((id) => accountIds.has(id)),
  };
}

async function WakeupLoader({ userId }: { userId: string }) {
  let supabase: Awaited<ReturnType<typeof createServerClient>>;
  try {
    supabase = await createServerClient();
  } catch (error) {
    console.error("Failed to create Supabase client:", error);
    return <LoadFailed />;
  }

  // Config and accounts are independent reads, so fetch them concurrently.
  const [configResult, accountsResult] = await Promise.allSettled([
    getWakeupConfig(supabase, userId),
    loadAccounts(supabase, userId),
  ]);

  if (configResult.status === "rejected") {
    console.error("Failed to load wakeup config:", configResult.reason);
    return <LoadFailed />;
  }

  const accountsLoadFailed = accountsResult.status === "rejected";
  if (accountsResult.status === "rejected") {
    // The form still works without the account list, so log and degrade.
    console.error(
      "Failed to load accounts for wakeup config:",
      accountsResult.reason,
    );
  }

  const accounts =
    accountsResult.status === "fulfilled" ? accountsResult.value : [];

  return (
    <WakeupConfigForm
      initialConfig={pruneUnavailableSelections(
        configResult.value,
        accounts,
        accountsLoadFailed,
      )}
      accounts={accounts}
      accountsLoadFailed={accountsLoadFailed}
    />
  );
}

async function loadAccounts(
  supabase: Awaited<ReturnType<typeof createServerClient>>,
  userId: string,
): Promise<WakeupAccountOption[]> {
  const { data, error } = await supabase
    .from("google_accounts")
    .select("id, email, display_name, token_status")
    .eq("clerk_user_id", userId)
    .order("added_at", { ascending: true });

  if (error) {
    throw new Error(`Failed to load accounts: ${error.message}`);
  }

  return (data ?? []).map((row) => ({
    id: row.id,
    email: row.email,
    displayName: row.display_name,
    tokenStatus: row.token_status,
  }));
}

export default async function WakeupPage() {
  const { userId } = await auth();

  if (!userId) {
    redirect("/sign-in");
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-bold tracking-tight">Wakeup</h1>
        <p className="text-sm text-muted-foreground">
          Keep your Antigravity quota windows warm by triggering tiny prompts on
          a schedule.
        </p>
      </div>
      <Suspense fallback={<WakeupSkeleton />}>
        <WakeupLoader userId={userId} />
      </Suspense>
    </div>
  );
}
