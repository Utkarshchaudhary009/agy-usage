import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { WakeupConfigForm } from "@/components/wakeup/config-form";
import { createServerClient } from "@/lib/supabase/server";
import type { WakeupAccount } from "@/lib/types/wakeup";
import { getWakeupConfig } from "@/lib/wakeup/config";

function WakeupSkeleton() {
  return (
    <div className="flex flex-col gap-6">
      <Skeleton className="h-7 w-40" />
      <div className="space-y-4 rounded-xl bg-card p-6 ring-1 ring-foreground/10">
        <Skeleton className="h-12 w-full" />
        <Skeleton className="h-40 w-full" />
        <Skeleton className="h-10 w-32" />
      </div>
    </div>
  );
}

async function WakeupLoader({ userId }: { userId: string }) {
  const supabase = await createServerClient();

  const [config, accountsResult] = await Promise.all([
    getWakeupConfig(supabase, userId),
    supabase
      .from("google_accounts")
      .select("id, email, display_name")
      .eq("clerk_user_id", userId)
      .order("added_at", { ascending: true }),
  ]);

  if (accountsResult.error) {
    throw new Error(`Failed to load accounts: ${accountsResult.error.message}`);
  }

  const accounts: WakeupAccount[] = (accountsResult.data ?? []).map((a) => ({
    id: a.id,
    email: a.email,
    displayName: a.display_name ?? null,
  }));

  return <WakeupConfigForm initialConfig={config} accounts={accounts} />;
}

export default async function WakeupPage() {
  const { userId } = await auth();
  if (!userId) redirect("/sign-in");

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Wakeup</h1>
        <p className="text-sm text-muted-foreground">
          Configure automated wake triggers to keep your models active.
        </p>
      </div>
      <Suspense fallback={<WakeupSkeleton />}>
        <WakeupLoader userId={userId} />
      </Suspense>
    </div>
  );
}
