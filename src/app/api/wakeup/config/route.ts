import { auth } from "@clerk/nextjs/server";
import { type NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase/server";
import type { WakeupConfigFormData } from "@/lib/types/wakeup";

function errorJson(
  body: { error: string; code: string; message: string },
  status: number,
) {
  return NextResponse.json(body, { status });
}

function unauthorized() {
  return errorJson(
    {
      error: "Unauthorized",
      code: "UNAUTHORIZED",
      message: "You must be logged in to manage wakeup config.",
    },
    401,
  );
}

function badRequest(message: string) {
  return errorJson(
    {
      error: "Bad Request",
      code: "BAD_REQUEST",
      message,
    },
    400,
  );
}

function validateCron(expression: string): boolean {
  const parts = expression.trim().split(/\s+/);
  if (parts.length !== 5) return false;
  const fieldRanges = [
    [0, 59],
    [0, 59],
    [0, 23],
    [1, 31],
    [1, 12],
  ];
  const _fieldNames = [
    "minute",
    "hour",
    "day of month",
    "month",
    "day of week",
  ];
  for (let i = 0; i < 5; i++) {
    const part = parts[i];
    const [min, max] = fieldRanges[i];
    if (part === "*") continue;
    const ranges = part.split(",");
    for (const range of ranges) {
      const match = range.match(/^(\d+)(?:-(\d+))?(?:\/(\d+))?$/);
      if (!match) return false;
      const start = parseInt(match[1], 10);
      const end = match[2] ? parseInt(match[2], 10) : start;
      const step = match[3] ? parseInt(match[3], 10) : 1;
      if (start < min || end > max || start > end || step < 1) return false;
    }
  }
  return true;
}

export async function GET(_req: NextRequest) {
  const { userId } = await auth();
  if (!userId) return unauthorized();

  const supabase = await createServerClient();

  const { data, error } = await supabase
    .from("wakeup_configs")
    .select("*")
    .eq("clerk_user_id", userId)
    .single();

  if (error && error.code !== "PGRST116") {
    return errorJson(
      {
        error: "Internal Server Error",
        code: "INTERNAL_ERROR",
        message: "Failed to fetch wakeup config.",
      },
      500,
    );
  }

  if (!data) {
    return NextResponse.json({ config: null });
  }

  const config = {
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
  };

  return NextResponse.json({ config });
}

export async function PUT(req: NextRequest) {
  const { userId } = await auth();
  if (!userId) return unauthorized();

  let body: WakeupConfigFormData;
  try {
    body = await req.json();
  } catch {
    return badRequest("Invalid JSON body.");
  }

  const {
    enabled,
    selectedModels,
    selectedAccountIds,
    scheduleMode,
    intervalHours,
    dailyTimes,
    cronExpression,
    customPrompt,
    maxOutputTokens,
    cooldownMinutes,
    wakeOnReset,
  } = body;

  if (!Array.isArray(selectedModels) || selectedModels.length === 0) {
    return badRequest("At least one model must be selected.");
  }

  if (!Array.isArray(selectedAccountIds)) {
    return badRequest("selectedAccountIds must be an array.");
  }

  if (scheduleMode === "custom" && !cronExpression) {
    return badRequest("cron_expression is required for custom schedule mode.");
  }

  if (
    scheduleMode === "custom" &&
    cronExpression &&
    !validateCron(cronExpression)
  ) {
    return badRequest("Invalid cron expression.");
  }

  if (
    typeof intervalHours !== "number" ||
    intervalHours < 1 ||
    intervalHours > 24
  ) {
    return badRequest("interval_hours must be between 1 and 24.");
  }

  if (
    typeof cooldownMinutes !== "number" ||
    cooldownMinutes < 1 ||
    cooldownMinutes > 1440
  ) {
    return badRequest("cooldown_minutes must be between 1 and 1440.");
  }

  if (
    typeof maxOutputTokens !== "number" ||
    maxOutputTokens < 1 ||
    maxOutputTokens > 10000
  ) {
    return badRequest("max_output_tokens must be between 1 and 10000.");
  }

  const supabase = await createServerClient();

  const { data: _existing, error: fetchError } = await supabase
    .from("wakeup_configs")
    .select("id")
    .eq("clerk_user_id", userId)
    .single();

  if (fetchError && fetchError.code !== "PGRST116") {
    return errorJson(
      {
        error: "Internal Server Error",
        code: "INTERNAL_ERROR",
        message: "Failed to check existing wakeup config.",
      },
      500,
    );
  }

  const upsertData = {
    clerk_user_id: userId,
    enabled,
    selected_models: selectedModels,
    selected_account_ids: selectedAccountIds,
    schedule_mode: scheduleMode,
    interval_hours: intervalHours,
    daily_times: dailyTimes,
    cron_expression: scheduleMode === "custom" ? cronExpression : null,
    custom_prompt: customPrompt,
    max_output_tokens: maxOutputTokens,
    cooldown_minutes: cooldownMinutes,
    wake_on_reset: wakeOnReset,
    updated_at: new Date().toISOString(),
  };

  const { error: upsertError } = await supabase
    .from("wakeup_configs")
    .upsert(upsertData, { onConflict: "clerk_user_id" });

  if (upsertError) {
    return errorJson(
      {
        error: "Internal Server Error",
        code: "INTERNAL_ERROR",
        message: "Failed to save wakeup config.",
      },
      500,
    );
  }

  return NextResponse.json({ success: true });
}
