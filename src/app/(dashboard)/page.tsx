import { auth } from "@clerk/nextjs/server";
import Link from "next/link";
import { DashboardClient } from "@/components/quota/dashboard-client";
import { Button } from "@/components/ui/button";
import { getQuotaAllAccounts } from "@/lib/quota/service";

export default async function Home() {
  const { userId } = await auth();

  // If logged in, this becomes the dashboard homepage
  if (userId) {
    const snapshots = await getQuotaAllAccounts(userId);

    const latestTimestamp =
      snapshots.length > 0
        ? snapshots
            .map((s) => new Date(s.timestamp).getTime())
            .sort((a, b) => b - a)[0]
        : Date.now();

    return (
      <div className="flex flex-col gap-6">
        <h1 className="text-2xl font-bold tracking-tight">
          Dashboard Overview
        </h1>
        <DashboardClient
          initialSnapshots={snapshots}
          initialCachedAt={new Date(latestTimestamp).toISOString()}
        />
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
