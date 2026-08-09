import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { ConfigForm } from "@/components/wakeup/config-form";
import { createServerClient } from "@/lib/supabase/server";
import { getWakeupConfig } from "@/lib/wakeup/config";

export default async function WakeupPage() {
  const { userId } = await auth();
  if (!userId) redirect("/sign-in");

  const supabase = await createServerClient();
  const { data: accounts, error } = await supabase
    .from("google_accounts")
    .select("id, email")
    .eq("clerk_user_id", userId)
    .order("added_at", { ascending: true });

  if (error) {
    console.error("Failed to load accounts for wakeup page:", error);
  }

  const config = await getWakeupConfig();

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Wakeup</h1>
        <p className="text-sm text-muted-foreground">
          Configure automated wakeup triggers to keep your models responsive.
        </p>
      </div>
      <ConfigForm
        initialConfig={config}
        accounts={accounts?.map((a) => ({ id: a.id, email: a.email })) ?? []}
      />
    </div>
  );
}
