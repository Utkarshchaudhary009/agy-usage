import { auth } from "@clerk/nextjs/server";
import { type NextRequest, NextResponse } from "next/server";
import { errorJson, internalError } from "@/lib/api/accounts";
import { createServerClient } from "@/lib/supabase/server";
import type { Database } from "@/lib/types/database";
import { toWakeupConfig } from "@/lib/wakeup/mapper";
import { validateWakeupConfigInput } from "@/lib/wakeup/validation";

export async function GET() {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json(
      {
        error: "Unauthorized",
        code: "UNAUTHORIZED",
        message: "You must be logged in to view your wakeup config.",
      },
      { status: 401 },
    );
  }

  const supabase = await createServerClient();
  const { data: row, error } = await supabase
    .from("wakeup_configs")
    .select("*")
    .eq("clerk_user_id", userId)
    .maybeSingle();

  if (error) return internalError("load wakeup config", error);

  // A missing row is expected for first-time users; the client falls back to
  // documented defaults.
  return NextResponse.json({ config: row ? toWakeupConfig(row) : null });
}

export async function PUT(req: NextRequest) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json(
      {
        error: "Unauthorized",
        code: "UNAUTHORIZED",
        message: "You must be logged in to save your wakeup config.",
      },
      { status: 401 },
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return validationFailed("Request body must be valid JSON.");
  }

  const result = validateWakeupConfigInput(body);
  if (!result.ok) return validationFailed(result.error);

  const config = result.value;

  const supabase = await createServerClient();

  // Verify every selected account is owned by this user before persisting;
  // RLS would hide foreign rows, but we reject explicitly for a clear error.
  if (config.selectedAccountIds.length > 0) {
    const { data: owned, error: ownedError } = await supabase
      .from("google_accounts")
      .select("id")
      .eq("clerk_user_id", userId)
      .in("id", config.selectedAccountIds);

    if (ownedError) return internalError("save wakeup config", ownedError);

    // An account deleted between selection and save shows up as missing here.
    // The scheduler re-checks ownership at trigger time, so a stale id that
    // slips through a concurrent delete is inert rather than dangerous.
    if ((owned ?? []).length !== config.selectedAccountIds.length) {
      return validationFailed(
        "One or more selected accounts no longer exist. Refresh and try again.",
      );
    }
  }

  const payload: Database["public"]["Tables"]["wakeup_configs"]["Insert"] = {
    clerk_user_id: userId,
    enabled: config.enabled,
    selected_models: config.selectedModels,
    selected_account_ids: config.selectedAccountIds,
    schedule_mode: config.scheduleMode,
    interval_hours: config.intervalHours,
    daily_times: config.dailyTimes,
    cron_expression: config.cronExpression,
    custom_prompt: config.customPrompt,
    max_output_tokens: config.maxOutputTokens,
    cooldown_minutes: config.cooldownMinutes,
    wake_on_reset: config.wakeOnReset,
    updated_at: new Date().toISOString(),
  };

  const { data: row, error } = await supabase
    .from("wakeup_configs")
    .upsert(payload, { onConflict: "clerk_user_id" })
    .select()
    .single();

  if (error || !row) return internalError("save wakeup config", error);

  return NextResponse.json({ config: toWakeupConfig(row) });
}

function validationFailed(message: string) {
  return errorJson(
    {
      error: "Bad Request",
      code: "VALIDATION_ERROR",
      message,
    },
    400,
  );
}
