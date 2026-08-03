import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { createServerClient } from "@/lib/supabase/server";
import { HistoryCharts } from "./history-charts";

async function AccountLoader({ userId }: { userId: string }) {
  const supabase = await createServerClient();
  const { data: accounts, error } = await supabase
    .from("google_accounts")
    .select("*")
    .eq("clerk_user_id", userId)
    .order("added_at", { ascending: false });

  if (error) {
    console.error("Failed to load accounts:", error);
    return (
      <div className="p-8">
        <h2 className="text-xl font-bold text-red-600">
          Failed to load accounts
        </h2>
        <p className="text-muted-foreground">
          An error occurred while loading your accounts. Please try again later.
        </p>
      </div>
    );
  }

  return <HistoryCharts accounts={accounts || []} />;
}

export default async function HistoryPage() {
  const { userId } = await auth();

  if (!userId) {
    redirect("/sign-in");
  }

  return (
    <Suspense
      fallback={
        <div className="p-8 space-y-4">
          <Skeleton className="h-10 w-[250px]" />
          <Skeleton className="h-[400px] w-full" />
        </div>
      }
    >
      <AccountLoader userId={userId} />
    </Suspense>
  );
}
