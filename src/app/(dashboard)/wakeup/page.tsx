import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import {
  ConfigForm,
  type LinkedAccountOption,
} from "@/components/wakeup/config-form";
import { createServerClient } from "@/lib/supabase/server";
import { DEFAULT_WAKEUP_CONFIG, type WakeupConfig } from "@/lib/types/wakeup";

async function WakeupLoader({ userId }: { userId: string }) {
  const supabase = await createServerClient();

  const [{ data: configRow }, { data: accounts }] = await Promise.all([
    supabase
      .from("wakeup_configs")
      .select("*")
      .eq("clerk_user_id", userId)
      .maybeSingle(),
    supabase
      .from("google_accounts")
      .select("id, email, display_name")
      .eq("clerk_user_id", userId)
      .order("added_at", { ascending: true }),
  ]);

  const config: WakeupConfig = configRow
    ? {
        enabled: configRow.enabled,
        selectedModels: configRow.selected_models ?? [],
        selectedAccountIds: configRow.selected_account_ids ?? [],
        scheduleMode: configRow.schedule_mode,
        intervalHours: configRow.interval_hours,
        dailyTimes: configRow.daily_times ?? [],
        cronExpression: configRow.cron_expression,
        customPrompt: configRow.custom_prompt,
        maxOutputTokens: configRow.max_output_tokens,
        cooldownMinutes: configRow.cooldown_minutes,
        wakeOnReset: configRow.wake_on_reset,
      }
    : DEFAULT_WAKEUP_CONFIG;

  const accountOptions: LinkedAccountOption[] = (accounts ?? []).map((a) => ({
    id: a.id,
    email: a.email,
    displayName: a.display_name,
  }));

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
