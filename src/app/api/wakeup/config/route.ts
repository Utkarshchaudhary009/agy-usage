import { auth } from "@clerk/nextjs/server";
import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { DEFAULT_WAKEUP_CONFIG, type WakeupConfig } from "@/lib/types/wakeup";
import { getWakeupConfig, saveWakeupConfig } from "@/lib/wakeup/config";
import { validateCronExpression } from "@/lib/wakeup/cron-validation";

const timeRegex = /^([01]\d|2[0-3]):[0-5]\d$/;

const configSchema = z.object({
  enabled: z.boolean(),
  selectedModels: z
    .array(z.string())
    .default(DEFAULT_WAKEUP_CONFIG.selectedModels),
  selectedAccountIds: z.array(z.string().uuid()).default([]),
  scheduleMode: z.enum(["interval", "daily", "custom"]),
  intervalHours: z.number().int().min(1).max(168),
  dailyTimes: z
    .array(z.string().regex(timeRegex, "Times must be HH:MM (24h)."))
    .max(24),
  cronExpression: z.string().trim().min(1).max(120).nullable(),
  customPrompt: z.string().min(1).max(500),
  maxOutputTokens: z.number().int().min(1).max(8192),
  cooldownMinutes: z.number().int().min(0).max(1440),
  wakeOnReset: z.boolean(),
});

export async function GET() {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json(
      {
        error: "Unauthorized",
        code: "UNAUTHORIZED",
        message: "You must be logged in.",
      },
      { status: 401 },
    );
  }

  const config = await getWakeupConfig();
  return NextResponse.json({ config });
}

export async function PUT(req: NextRequest) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json(
      {
        error: "Unauthorized",
        code: "UNAUTHORIZED",
        message: "You must be logged in.",
      },
      { status: 401 },
    );
  }

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

  const parsed = configSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: "Validation Error",
        code: "INVALID_CONFIG",
        message: parsed.error.issues[0]?.message ?? "Invalid configuration.",
      },
      { status: 422 },
    );
  }

  const config: WakeupConfig = parsed.data;

  // Custom cron schedules require a syntactically valid expression.
  if (config.scheduleMode === "custom") {
    if (!config.cronExpression) {
      return NextResponse.json(
        {
          error: "Validation Error",
          code: "INVALID_CRON",
          message: "Custom schedule requires a cron expression.",
        },
        { status: 422 },
      );
    }
    const cron = validateCronExpression(config.cronExpression);
    if (!cron.valid) {
      return NextResponse.json(
        {
          error: "Validation Error",
          code: "INVALID_CRON",
          message: cron.error ?? "Invalid cron expression.",
        },
        { status: 422 },
      );
    }
  }

  try {
    await saveWakeupConfig(config);
  } catch (cause) {
    console.error("Failed to save wakeup config:", cause);
    return NextResponse.json(
      {
        error: "Internal Server Error",
        code: "SAVE_FAILED",
        message: "Could not save your wakeup configuration.",
      },
      { status: 500 },
    );
  }

  return NextResponse.json({ config, success: true });
}
