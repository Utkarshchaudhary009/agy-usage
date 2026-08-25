import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { ConfigForm } from "@/components/wakeup/config-form";
import { WakeupHistory } from "@/components/wakeup/history-table";
import { createServerClient } from "@/lib/supabase/server";
import type { WakeupAccountOption } from "@/lib/types/wakeup";
import { getCooldownStatus } from "@/lib/wakeup/cooldown";
import { toWakeupConfig } from "@/lib/wakeup/mapper";
import { defaultWakeupConfig } from "@/lib/wakeup/models";

function WakeupSkeleton() {
  return (
    <div className="flex flex-col gap-6">
      <div className="space-y-3 rounded-xl bg-card p-4 ring-1 ring-foreground/10">
        <Skeleton className="h-5 w-40" />
        <Skeleton className="h-3 w-72" />
      </div>
      {[0, 1, 2].map((key) => (
        <div
          key={key}
          className="space-y-3 rounded-xl bg-card p-4 ring-1 ring-foreground/10"
        >
          <Skeleton className="h-4 w-32" />
          <div className="grid gap-2 sm:grid-cols-2">
            <Skeleton className="h-12 rounded-lg" />
            <Skeleton className="h-12 rounded-lg" />
          </div>
        </div>
      ))}
    </div>
  );
}

async function WakeupLoader({ userId }: { userId: string }) {
  const supabase = await createServerClient();

  const [configResult, accountsResult] = await Promise.all([
    supabase
      .from("wakeup_configs")
      .select("*")
      .eq("clerk_user_id", userId)
      .maybeSingle(),
    supabase
      .from("google_accounts")
      .select("id, email, is_active, token_status")
      .eq("clerk_user_id", userId)
      .order("added_at", { ascending: true }),
  ]);
  const cooldown = await getCooldownStatus(userId);

  if (configResult.error) {
    console.error("Failed to load wakeup config:", configResult.error);
  }
  if (accountsResult.error) {
    console.error("Failed to load accounts for wakeup:", accountsResult.error);
  }

  // A missing config row is expected for first-time users; fall back to
  // defaults so the form renders with documented values.
  const config = configResult.data
    ? toWakeupConfig(configResult.data)
    : defaultWakeupConfig();

  const accounts: WakeupAccountOption[] = accountsResult.error
    ? []
    : (accountsResult.data ?? []).map((row) => ({
        id: row.id,
        email: row.email,
        isActive: row.is_active,
        tokenStatus: row.token_status,
      }));

  // Keying on updatedAt remounts the form when the saved row changes (e.g.
  // edited in another tab) instead of leaving stale draft state behind.
  return (
    <div className="flex flex-col gap-6">
      <ConfigForm
        key={config.updatedAt ?? "new"}
        initialConfig={config}
        accounts={accounts}
        accountsUnavailable={Boolean(accountsResult.error)}
        lastTriggerAt={
          cooldown.lastTriggerAt ? new Date(cooldown.lastTriggerAt) : null
        }
      />
      <WakeupHistory
        accounts={accounts.map(({ id, email }) => ({ id, email }))}
      />
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
      <h1 className="text-2xl font-bold tracking-tight">Wakeup</h1>
      <Suspense fallback={<WakeupSkeleton />}>
        <WakeupLoader userId={userId} />
      </Suspense>
    </div>
  );
}
