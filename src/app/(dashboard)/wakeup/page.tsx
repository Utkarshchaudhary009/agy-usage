import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { ConfigForm } from "@/components/wakeup/config-form";
import { createServerClient } from "@/lib/supabase/server";
import type { WakeupAccountOption, WakeupConfig } from "@/lib/types/wakeup";
import { DEFAULT_WAKEUP_CONFIG } from "@/lib/types/wakeup";
import { dbRowToWakeupConfig } from "@/lib/wakeup/validation";

async function WakeupLoader({ userId }: { userId: string }) {
  const supabase = await createServerClient();

  const [configResult, accountsResult] = await Promise.all([
    supabase
      .from("wakeup_configs")
      .select(
        "enabled, selected_models, selected_account_ids, schedule_mode, interval_hours, daily_times, cron_expression, custom_prompt, max_output_tokens, cooldown_minutes, wake_on_reset",
      )
      .eq("clerk_user_id", userId)
      .maybeSingle(),
    supabase
      .from("google_accounts")
      .select("id, email, display_name, is_active, token_status")
      .eq("clerk_user_id", userId)
      .order("added_at", { ascending: true }),
  ]);

  if (configResult.error) {
    console.error("Failed to load wakeup config:", configResult.error);
  }

  const config: WakeupConfig = configResult.data
    ? dbRowToWakeupConfig(configResult.data)
    : DEFAULT_WAKEUP_CONFIG;

  const accounts: WakeupAccountOption[] = (accountsResult.data ?? []).map(
    (row) => ({
      id: row.id,
      email: row.email,
      displayName: row.display_name,
      isActive: row.is_active,
      tokenStatus: row.token_status,
    }),
  );

  return <ConfigForm config={config} accounts={accounts} />;
}

function WakeupSkeleton() {
  return (
    <div className="flex flex-col gap-4">
      <Skeleton className="h-10 w-48" />
      <Skeleton className="h-[520px] w-full rounded-xl" />
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
          Keep your models warm with automated, low-cost triggers.
        </p>
      </div>
      <Suspense fallback={<WakeupSkeleton />}>
        <WakeupLoader userId={userId} />
      </Suspense>
    </div>
  );
}
