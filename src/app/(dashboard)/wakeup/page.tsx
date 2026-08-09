import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import {
  type AccountOption,
  ConfigForm,
} from "@/components/wakeup/config-form";
import { createServerClient } from "@/lib/supabase/server";
import {
  DEFAULT_WAKEUP_CONFIG,
  dbConfigToWakeup,
  type WakeupConfig,
} from "@/lib/types/wakeup";

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
      .select("id, email, display_name, token_status")
      .eq("clerk_user_id", userId)
      .order("added_at", { ascending: true }),
  ]);

  const config: WakeupConfig = configRow
    ? dbConfigToWakeup(configRow)
    : DEFAULT_WAKEUP_CONFIG;

  const accountOptions: AccountOption[] = (accounts ?? []).map((a) => ({
    id: a.id,
    email: a.email,
    displayName: a.display_name,
    tokenStatus: a.token_status,
  }));

  return <ConfigForm initialConfig={config} accounts={accountOptions} />;
}

function WakeupSkeleton() {
  return (
    <div className="flex flex-col gap-6">
      {[0, 1, 2, 3].map((i) => (
        <div
          key={i}
          className="space-y-3 rounded-xl bg-card p-4 ring-1 ring-foreground/10"
        >
          <Skeleton className="h-5 w-40" />
          <Skeleton className="h-3 w-full" />
          <Skeleton className="h-20 w-full" />
        </div>
      ))}
    </div>
  );
}

export default async function WakeupPage() {
  const { userId } = await auth();
  if (!userId) redirect("/sign-in");

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Wakeup</h1>
        <p className="text-sm text-muted-foreground">
          Keep your Antigravity models warm with scheduled, minimal prompts.
        </p>
      </div>
      <Suspense fallback={<WakeupSkeleton />}>
        <WakeupLoader userId={userId} />
      </Suspense>
    </div>
  );
}
