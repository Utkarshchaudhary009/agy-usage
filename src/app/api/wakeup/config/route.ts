import { auth } from "@clerk/nextjs/server";
import { type NextRequest, NextResponse } from "next/server";
import {
  badRequest,
  internalError,
  unauthorized,
  validationError,
} from "@/lib/api/errors";
import { createServerClient } from "@/lib/supabase/server";
import {
  type ConfigRow,
  loadWakeupConfig,
  rowToConfig,
  validateWakeupConfig,
} from "@/lib/wakeup/config";

export async function GET() {
  const { userId } = await auth();
  if (!userId) {
    return unauthorized("You must be logged in to view wakeup config.");
  }

  try {
    const supabase = await createServerClient();
    const config = await loadWakeupConfig(supabase, userId);
    return NextResponse.json({ config });
  } catch (error) {
    return internalError("load wakeup configuration", error);
  }
}

export async function PUT(req: NextRequest) {
  const { userId } = await auth();
  if (!userId) {
    return unauthorized("You must be logged in to update wakeup config.");
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return badRequest("INVALID_JSON", "Request body must be valid JSON.");
  }

  try {
    const result = validateWakeupConfig(body);
    if (!result.valid || !result.config) {
      return validationError(result.error ?? "Invalid configuration.");
    }
    const config = result.config;

    const supabase = await createServerClient();

    // The account-ownership check and the upsert run inside a single
    // transaction in `save_wakeup_config`, so a selected account removed
    // between request validation and the write cannot slip through (TOCTOU).
    const { data, error: saveError } = await supabase.rpc(
      "save_wakeup_config",
      {
        p_clerk_user_id: userId,
        p_enabled: config.enabled,
        p_selected_models: config.selectedModels,
        p_selected_account_ids: config.selectedAccountIds,
        p_schedule_mode: config.scheduleMode,
        p_interval_hours: config.intervalHours,
        p_daily_times: config.dailyTimes,
        p_cron_expression: config.cronExpression,
        p_custom_prompt: config.customPrompt,
        p_max_output_tokens: config.maxOutputTokens,
        p_cooldown_minutes: config.cooldownMinutes,
        p_wake_on_reset: config.wakeOnReset,
      },
    );

    if (saveError) {
      // P0001 = the caller is not authorized to modify this config row.
      if (saveError.code === "P0001") {
        return unauthorized(
          "You are not authorized to modify this configuration.",
        );
      }
      // OWNAC = a selected account does not belong to this user.
      if (saveError.code === "OWNAC") {
        return validationError(
          "One or more selected accounts do not belong to this user.",
        );
      }
      return internalError("save wakeup configuration", saveError);
    }

    if (!data) {
      return internalError("save wakeup configuration");
    }

    return NextResponse.json({
      config: rowToConfig(data as ConfigRow),
    });
  } catch (error) {
    return internalError("save wakeup configuration", error);
  }
}
