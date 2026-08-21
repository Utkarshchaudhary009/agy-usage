import { auth } from "@clerk/nextjs/server";
import { type NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase/server";
import type { WakeupConfig } from "@/lib/types/wakeup";
import { DEFAULT_WAKEUP_CONFIG } from "@/lib/types/wakeup";
import {
  dbRowToWakeupConfig,
  validateWakeupConfig,
} from "@/lib/wakeup/validation";

function unauthorized() {
  return NextResponse.json(
    {
      error: "Unauthorized",
      code: "UNAUTHORIZED",
      message: "You must be logged in to manage wakeup settings.",
    },
    { status: 401 },
  );
}

function internalError(cause?: unknown) {
  console.error("Failed to manage wakeup config:", cause);
  return NextResponse.json(
    {
      error: "Internal Server Error",
      code: "INTERNAL_ERROR",
      message: "Failed to manage wakeup settings",
    },
    { status: 500 },
  );
}

export async function GET() {
  const { userId } = await auth();
  if (!userId) return unauthorized();

  const supabase = await createServerClient();
  const { data, error } = await supabase
    .from("wakeup_configs")
    .select(
      "enabled, selected_models, selected_account_ids, schedule_mode, interval_hours, daily_times, cron_expression, custom_prompt, max_output_tokens, cooldown_minutes, wake_on_reset",
    )
    .eq("clerk_user_id", userId)
    .maybeSingle();

  if (error) return internalError(error);

  const config: WakeupConfig = data
    ? dbRowToWakeupConfig(data)
    : DEFAULT_WAKEUP_CONFIG;

  return NextResponse.json({ config });
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

  const result = validateWakeupConfig(body);
  if (!result.ok) {
    return NextResponse.json(
      {
        error: "Validation Error",
        code: "VALIDATION_ERROR",
        message: result.error,
        field: result.field,
      },
      { status: 400 },
    );
  }

  const config = result.config;
  const supabase = await createServerClient();
  const { error } = await supabase.from("wakeup_configs").upsert(
    {
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
    },
    { onConflict: "clerk_user_id" },
  );

  if (error) return internalError(error);

  return NextResponse.json({ success: true, config });
}
