import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { WakeupConfigForm } from "@/components/wakeup/config-form";
import { createServerClient } from "@/lib/supabase/server";
import type { WakeupConfig } from "@/lib/types/wakeup";

function WakeupSkeleton() {
  return (
    <div className="flex flex-col gap-6">
      <Skeleton className="h-8 w-48" />
      <div className="grid gap-4 sm:grid-cols-2">
        <Skeleton className="h-20 w-full" />
        <Skeleton className="h-20 w-full" />
        <Skeleton className="h-20 w-full" />
        <Skeleton className="h-20 w-full" />
        <Skeleton className="h-20 w-full" />
        <Skeleton className="h-20 w-full" />
      </div>
    </div>
  );
}

async function WakeupLoader() {
  const { userId } = await auth();
  if (!userId) redirect("/sign-in");

  const supabase = await createServerClient();

  const { data, error } = await supabase
    .from("wakeup_configs")
    .select("*")
    .eq("clerk_user_id", userId)
    .single();

  if (error && error.code !== "PGRST116") {
    console.error("Failed to load wakeup config:", error);
  }

  const config: WakeupConfig | null = data
    ? {
        id: data.id,
        clerkUserId: data.clerk_user_id,
        enabled: data.enabled,
        selectedModels: data.selected_models,
        selectedAccountIds: data.selected_account_ids,
        scheduleMode: data.schedule_mode,
        intervalHours: data.interval_hours,
        dailyTimes: data.daily_times,
        cronExpression: data.cron_expression,
        customPrompt: data.custom_prompt,
        maxOutputTokens: data.max_output_tokens,
        cooldownMinutes: data.cooldown_minutes,
        wakeOnReset: data.wake_on_reset,
        updatedAt: data.updated_at,
      }
    : null;

  return <WakeupConfigForm initialConfig={config} />;
}

export default function WakeupPage() {
  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-bold tracking-tight">Wakeup</h1>
      <Suspense fallback={<WakeupSkeleton />}>
        <WakeupLoader />
      </Suspense>
    </div>
  );
}
