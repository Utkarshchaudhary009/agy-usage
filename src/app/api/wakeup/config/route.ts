import { auth } from "@clerk/nextjs/server";
import { type NextRequest, NextResponse } from "next/server";
import { errorJson, internalError, unauthorized } from "@/lib/api/accounts";
import { createServerClient } from "@/lib/supabase/server";
import type { WakeupConfig } from "@/lib/types/wakeup";
import { DEFAULT_WAKEUP_CONFIG } from "@/lib/types/wakeup";
import {
  dbRowToWakeupConfig,
  validateWakeupConfig,
  WAKEUP_CONFIG_SELECT,
} from "@/lib/wakeup/validation";

export async function GET() {
  const { userId } = await auth();
  if (!userId) return unauthorized();

  const supabase = await createServerClient();
  const { data, error } = await supabase
    .from("wakeup_configs")
    .select(WAKEUP_CONFIG_SELECT)
    .eq("clerk_user_id", userId)
    .maybeSingle();

  if (error) return internalError("load wakeup config", error);

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
    return errorJson(
      {
        error: "Bad Request",
        code: "INVALID_JSON",
        message: "Request body must be valid JSON.",
      },
      400,
    );
  }

  const result = validateWakeupConfig(body);
  if (!result.ok) {
    return errorJson(
      {
        error: "Validation Error",
        code: "VALIDATION_ERROR",
        message: result.error,
        field: result.field,
      },
      400,
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

  if (error) return internalError("save wakeup config", error);

  return NextResponse.json({ success: true, config });
}
