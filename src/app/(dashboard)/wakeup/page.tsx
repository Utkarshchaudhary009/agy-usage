import "server-only";
import { auth } from "@clerk/nextjs/server";
import type { Metadata } from "next";
import { Suspense } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { ConfigForm } from "@/components/wakeup/config-form";
import { createServerClient } from "@/lib/supabase/server";
import type { WakeupAccount } from "@/lib/types/wakeup";
import { getWakeupConfig } from "@/lib/wakeup/config";

export const metadata: Metadata = {
  title: "Wakeup",
  description:
    "Keep your models warm by periodically triggering a small request. This prevents cold starts and keeps your quota counters active.",
};

function WakeupSkeleton() {
  return (
    <div className="flex flex-col gap-6">
      {[0, 1, 2, 3].map((key) => (
        <Skeleton key={key} className="h-40 w-full rounded-xl" />
      ))}
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
    console.error("Failed to load accounts:", accountsResult.error);
    throw new Error("Failed to load accounts");
  }

  const accounts: WakeupAccount[] = (accountsResult.data ?? []).map((row) => ({
    id: row.id,
    email: row.email,
    displayName: row.display_name,
  }));

  // Key by config id so the form (and its child SchedulePicker, which mirrors
  // `dailyTimes` into its own local state) remounts with fresh initial values
  // only when the underlying config actually changes — e.g. switching users.
  // A plain `router.refresh()` returns the same id and therefore does NOT
  // remount, which avoids the derived-state-from-props anti-pattern of copying
  // the prop into every field via an effect and clobbering in-progress edits.
  return (
    <ConfigForm key={config?.id ?? "new"} config={config} accounts={accounts} />
  );
}

export default async function WakeupPage() {
  // Enforce auth through Clerk rather than a manual redirect: auth.protect()
  // redirects unauthenticated visitors to sign-in while preserving the current
  // URL as the post-login return destination (the route is already gated by
  // middleware, so this is defense-in-depth that also yields the userId).
  const { userId } = await auth.protect();

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Wakeup</h1>
        <p className="text-sm text-muted-foreground">
          Keep your models warm by periodically triggering a small request. This
          prevents cold starts and keeps your quota counters active.
        </p>
      </div>
      <Suspense fallback={<WakeupSkeleton />}>
        <WakeupLoader userId={userId} />
      </Suspense>
    </div>
  );
}
