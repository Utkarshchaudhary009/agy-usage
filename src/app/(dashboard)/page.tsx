import { auth } from "@clerk/nextjs/server";
import Link from "next/link";
import { Suspense } from "react";
import { DashboardClient } from "@/components/quota/dashboard-client";
import { QuotaGridSkeleton } from "@/components/quota/skeletons";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { StatusWidget } from "@/components/wakeup/status-widget";
import { getQuotaAllAccounts } from "@/lib/quota/service";
import { createServerClient } from "@/lib/supabase/server";
import { toWakeupConfig } from "@/lib/wakeup/mapper";
import { defaultWakeupConfig } from "@/lib/wakeup/models";

async function WakeupStatusLoader({ userId }: { userId: string }) {
  const supabase = await createServerClient();
  const [configResult, lastLogResult] = await Promise.all([
    supabase
      .from("wakeup_configs")
      .select("*")
      .eq("clerk_user_id", userId)
      .maybeSingle(),
    supabase
      .from("wakeup_logs")
      .select("success, created_at")
      .eq("clerk_user_id", userId)
      .order("created_at", { ascending: false })
      .limit(1),
  ]);
  if (configResult.error) {
    console.error("Failed to load wakeup config:", configResult.error);
  }
  if (lastLogResult.error) {
    console.error("Failed to load wakeup logs:", lastLogResult.error);
  }

  const row = configResult.data;
  const lastLog = lastLogResult.data?.[0];
  return (
    <StatusWidget
      config={row ? toWakeupConfig(row) : defaultWakeupConfig()}
      lastTriggerAt={row?.last_run_started_at ?? null}
      lastOutcome={
        lastLog
          ? { success: lastLog.success, createdAt: lastLog.created_at }
          : null
      }
    />
  );
}

async function QuotaDashboardLoader({ userId }: { userId: string }) {
  const snapshots = await getQuotaAllAccounts(userId);

  const latestTimestamp =
    snapshots.length > 0
      ? snapshots
          .map((s) => new Date(s.timestamp).getTime())
          .sort((a, b) => b - a)[0]
      : Date.now();

  return (
    <DashboardClient
      initialSnapshots={snapshots}
      initialCachedAt={new Date(latestTimestamp).toISOString()}
    />
  );
}

export default async function Home() {
  const { userId } = await auth();

  // If logged in, this becomes the dashboard homepage
  if (userId) {
    return (
      <div className="flex flex-col gap-6">
        <h1 className="text-2xl font-bold tracking-tight">
          Dashboard Overview
        </h1>
        <Suspense fallback={<QuotaGridSkeleton />}>
          <QuotaDashboardLoader userId={userId} />
        </Suspense>
        <Suspense fallback={<Skeleton className="h-48 rounded-xl" />}>
          <WakeupStatusLoader userId={userId} />
        </Suspense>
      </div>
    );
  }

  // If not logged in, render the landing page
  return (
    <div className="flex min-h-screen items-center justify-center bg-background">
      <main className="text-center px-8">
        <h1 className="mb-4 text-4xl font-bold text-foreground">
          Antigravity Usage Dashboard
        </h1>
        <p className="mx-auto mb-8 max-w-md text-lg text-muted-foreground">
          Cloud-based dashboard for Antigravity coding agent quota/usage across
          all Google accounts. Sign in with Clerk to get started.
        </p>
        <div className="flex justify-center gap-4">
          <Button asChild size="lg">
            <Link href="/sign-in">Sign In</Link>
          </Button>
          <Button asChild variant="outline" size="lg">
            <Link href="/sign-up">Sign Up</Link>
          </Button>
        </div>
      </main>
    </div>
  );
}
