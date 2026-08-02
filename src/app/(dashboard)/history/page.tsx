import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { createServerClient } from "@/lib/supabase/server";
import { HistoryCharts } from "./history-charts";

export default async function HistoryPage() {
  const { userId } = await auth();

  if (!userId) {
    redirect("/sign-in");
  }

  const supabase = await createServerClient();
  const { data: accounts, error } = await supabase
    .from("google_accounts")
    .select("*")
    .eq("clerk_user_id", userId)
    .order("added_at", { ascending: false });

  if (error) {
    // Basic error boundary rendering
    return (
      <div className="p-8">
        <h2 className="text-xl font-bold text-red-600">
          Failed to load accounts
        </h2>
        <p className="text-muted-foreground">{error.message}</p>
      </div>
    );
  }

  return <HistoryCharts accounts={accounts || []} />;
}
