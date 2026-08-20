import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import type { WakeupAccountOption } from "@/components/wakeup/config-form";
import { WakeupConfigForm } from "@/components/wakeup/config-form";
import { createServerClient } from "@/lib/supabase/server";
import {
  defaultWakeupConfig,
  mapWakeupConfigRow,
  type WakeupConfig,
} from "@/lib/types/wakeup";

function WakeupSkeleton() {
  return (
    <div className="flex flex-col gap-6">
      <Skeleton className="h-20 w-full rounded-xl" />
      <Skeleton className="h-40 w-full rounded-xl" />
      <Skeleton className="h-64 w-full rounded-xl" />
    </div>
  );
}

async function WakeupLoader({ userId }: { userId: string }) {
  const supabase = await createServerClient();

  const [{ data: configRow }, { data: accounts, error: accountsError }] =
    await Promise.all([
      supabase
        .from("wakeup_configs")
        .select("*")
        .eq("clerk_user_id", userId)
        .maybeSingle(),
      supabase
        .from("google_accounts")
        .select("id, email, is_active")
        .eq("clerk_user_id", userId)
        .order("added_at", { ascending: true }),
    ]);

  if (accountsError) {
    console.error("Failed to load accounts for wakeup page:", accountsError);
  }

  const config: WakeupConfig = configRow
    ? mapWakeupConfigRow(configRow)
    : defaultWakeupConfig(userId);

  const accountOptions: WakeupAccountOption[] = (accounts ?? []).map((a) => ({
    id: a.id,
    email: a.email,
    isActive: a.is_active,
  }));

  return <WakeupConfigForm initialConfig={config} accounts={accountOptions} />;
}

export default async function WakeupPage() {
  const { userId } = await auth();
  if (!userId) {
    redirect("/sign-in");
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="space-y-1">
        <h1 className="text-2xl font-bold tracking-tight">Wakeup</h1>
        <p className="text-sm text-muted-foreground">
          Automatically keep your models warm by triggering them on a schedule.
        </p>
      </div>
      <Suspense fallback={<WakeupSkeleton />}>
        <WakeupLoader userId={userId} />
      </Suspense>
    </div>
  );
}
