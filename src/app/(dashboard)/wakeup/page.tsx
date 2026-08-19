import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import {
  ConfigForm,
  type LinkedAccountOption,
} from "@/components/wakeup/config-form";
import { createServerClient } from "@/lib/supabase/server";
import { loadWakeupConfig } from "@/lib/wakeup/config";

async function WakeupLoader({ userId }: { userId: string }) {
  const supabase = await createServerClient();

  const [config, accountsResult] = await Promise.all([
    loadWakeupConfig(supabase, userId),
    supabase
      .from("google_accounts")
      .select("id, email, display_name")
      .eq("clerk_user_id", userId)
      .order("added_at", { ascending: true }),
  ]);

  // A failed accounts query must not be silently swallowed — surfacing the
  // failure is safer than letting the user save with an incomplete account
  // list.
  if (accountsResult.error) {
    throw new Error(
      `Failed to load linked accounts: ${accountsResult.error.message}`,
    );
  }

  const accountOptions: LinkedAccountOption[] = (accountsResult.data ?? []).map(
    (a) => ({
      id: a.id,
      email: a.email,
      displayName: a.display_name,
    }),
  );

  return <ConfigForm initialConfig={config} accounts={accountOptions} />;
}

function WakeupSkeleton() {
  return (
    <div className="flex flex-col gap-6">
      <Skeleton className="h-32 w-full rounded-xl" />
      <Skeleton className="h-48 w-full rounded-xl" />
      <Skeleton className="h-48 w-full rounded-xl" />
      <Skeleton className="h-64 w-full rounded-xl" />
    </div>
  );
}

export default async function WakeupPage() {
  const { userId } = await auth();

  if (!userId) {
    redirect("/sign-in");
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Wakeup</h1>
        <p className="text-sm text-muted-foreground">
          Configure automatic model wake-up to keep your accounts active.
        </p>
      </div>
      <Suspense fallback={<WakeupSkeleton />}>
        <WakeupLoader userId={userId} />
      </Suspense>
    </div>
  );
}
