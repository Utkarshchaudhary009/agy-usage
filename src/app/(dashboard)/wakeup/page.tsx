import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import {
  ConfigForm,
  type WakeupAccountOption,
} from "@/components/wakeup/config-form";
import { createServerClient } from "@/lib/supabase/server";
import type { WakeupConfig } from "@/lib/types/wakeup";
import { buildDefaultConfig, getWakeupConfig } from "@/lib/wakeup/config";

function WakeupSkeleton() {
  return (
    <div className="flex flex-col gap-6">
      <Skeleton className="h-40 w-full rounded-xl" />
      <Skeleton className="h-10 w-48" />
      <Skeleton className="h-64 w-full rounded-xl" />
    </div>
  );
}

async function WakeupLoader({ userId }: { userId: string }) {
  const supabase = await createServerClient();

  const [{ data: config }, { data: accounts, error: accountsError }] =
    await Promise.all([
      getWakeupConfig(supabase, userId).then((c) => ({
        data: c ?? buildDefaultConfig(userId),
      })),
      supabase
        .from("google_accounts")
        .select("id, email, display_name, is_active")
        .eq("clerk_user_id", userId)
        .order("added_at", { ascending: true }),
    ]);

  if (accountsError) {
    console.error("Failed to load accounts for wakeup:", accountsError);
  }

  const options: WakeupAccountOption[] = (accounts ?? []).map((a) => ({
    id: a.id,
    email: a.email,
    displayName: a.display_name,
    isActive: a.is_active,
  }));

  return (
    <ConfigForm initialConfig={config as WakeupConfig} accounts={options} />
  );
}

export default async function WakeupPage() {
  const { userId } = await auth();
  if (!userId) {
    redirect("/sign-in");
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-bold tracking-tight">Wakeup</h1>
        <p className="text-sm text-muted-foreground">
          Automatically keep selected models active so they stay responsive.
        </p>
      </div>
      <Suspense fallback={<WakeupSkeleton />}>
        <WakeupLoader userId={userId} />
      </Suspense>
    </div>
  );
}
