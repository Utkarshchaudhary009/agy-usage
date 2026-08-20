import { auth } from "@clerk/nextjs/server";
import { type NextRequest, NextResponse } from "next/server";
import { internalError, unauthorized } from "@/lib/api/accounts";
import { createServerClient } from "@/lib/supabase/server";
import {
  defaultWakeupConfig,
  mapWakeupConfigRow,
  parseWakeupConfig,
} from "@/lib/types/wakeup";

// Returns the current user's wakeup configuration, or sensible defaults when
// none has been saved yet. RLS scopes the row to the authenticated caller.
export async function GET() {
  const { userId } = await auth();
  if (!userId) return unauthorized();

  const supabase = await createServerClient();
  const { data, error } = await supabase
    .from("wakeup_configs")
    .select("*")
    .eq("clerk_user_id", userId)
    .maybeSingle();

  if (error) return internalError("load wakeup config", error);

  return NextResponse.json({
    config: data ? mapWakeupConfigRow(data) : defaultWakeupConfig(userId),
  });
}

export async function PUT(req: NextRequest) {
  const { userId } = await auth();
  if (!userId) return unauthorized();

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      {
        error: "Bad Request",
        code: "INVALID_JSON",
        message: "Request body must be valid JSON.",
      },
      { status: 400 },
    );
  }

  // The account ids are validated against the caller's own accounts before
  // persisting, so a config can never point at another user's account.
  const supabase = await createServerClient();
  const { data: accounts, error: accountsError } = await supabase
    .from("google_accounts")
    .select("id")
    .eq("clerk_user_id", userId);

  if (accountsError) {
    return internalError("load accounts", accountsError);
  }
  const ownedIds = new Set((accounts ?? []).map((a) => a.id));

  const { validation, ...config } = parseWakeupConfig(body, userId, []);

  if (!validation.valid) {
    return NextResponse.json(
      {
        error: "Validation Error",
        code: "INVALID_CONFIG",
        message: "The wakeup configuration contains invalid values.",
        errors: validation.errors,
      },
      { status: 422 },
    );
  }

  const filteredAccounts = config.selectedAccountIds.filter((id) =>
    ownedIds.has(id),
  );

  // Server-side cron validation (the only hard requirement for `custom` mode).
  if (config.scheduleMode === "custom" && config.cronExpression) {
    const { validateCron } = await import("@/lib/wakeup/cron");
    const result = validateCron(config.cronExpression);
    if (!result.valid) {
      return NextResponse.json(
        {
          error: "Validation Error",
          code: "INVALID_CRON",
          message: result.error ?? "Invalid cron expression.",
          errors: { cronExpression: result.error },
        },
        { status: 422 },
      );
    }
  }

  const { error: upsertError } = await supabase.from("wakeup_configs").upsert(
    {
      clerk_user_id: userId,
      enabled: config.enabled,
      selected_models: config.selectedModels,
      selected_account_ids: filteredAccounts,
      schedule_mode: config.scheduleMode,
      interval_hours: config.intervalHours,
      daily_times: config.dailyTimes,
      cron_expression: config.cronExpression,
      custom_prompt: config.customPrompt,
      max_output_tokens: config.maxOutputTokens,
      cooldown_minutes: config.cooldownMinutes,
      wake_on_reset: config.wakeOnReset,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "clerk_user_id" },
  );

  if (upsertError) return internalError("save wakeup config", upsertError);

  return NextResponse.json({
    config: { ...config, selectedAccountIds: filteredAccounts },
  });
}
