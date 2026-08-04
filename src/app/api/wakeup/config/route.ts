import { auth } from "@clerk/nextjs/server";
import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";
import { type NextRequest, NextResponse } from "next/server";
import { errorJson, internalError } from "@/lib/api/accounts";
import { createServerClient } from "@/lib/supabase/server";
import { getWakeupConfig, saveWakeupConfig } from "@/lib/wakeup/config-service";
import { validateWakeupConfigInput } from "@/lib/wakeup/validation";

/** The largest config payload is a few hundred bytes; anything larger is abuse. */
const MAX_BODY_BYTES = 16 * 1024;

let ratelimit: Ratelimit | undefined;
if (
  process.env.UPSTASH_REDIS_REST_URL &&
  process.env.UPSTASH_REDIS_REST_TOKEN
) {
  const redis = new Redis({
    url: process.env.UPSTASH_REDIS_REST_URL,
    token: process.env.UPSTASH_REDIS_REST_TOKEN,
  });

  ratelimit = new Ratelimit({
    redis,
    limiter: Ratelimit.slidingWindow(10, "1 m"),
    analytics: false,
  });
} else {
  console.warn(
    "Upstash rate limiting is not configured. UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN must be set to enable rate limiting.",
  );
}

function unauthorized() {
  return errorJson(
    {
      error: "Unauthorized",
      code: "UNAUTHORIZED",
      message: "You must be logged in to manage wakeup settings.",
    },
    401,
  );
}

function badRequest(message: string, field?: string) {
  return NextResponse.json(
    { error: "Bad Request", code: "BAD_REQUEST", message, field },
    { status: 400 },
  );
}

export async function GET() {
  const { userId } = await auth();
  if (!userId) return unauthorized();

  try {
    const supabase = await createServerClient();
    const config = await getWakeupConfig(supabase, userId);
    return NextResponse.json({ config });
  } catch (error) {
    return internalError("load wakeup config", error);
  }
}

export async function PUT(req: NextRequest) {
  const { userId } = await auth();
  if (!userId) return unauthorized();

  if (ratelimit) {
    try {
      const { success } = await ratelimit.limit(
        `ratelimit_wakeup_config_${userId}`,
      );
      if (!success) {
        return errorJson(
          {
            error: "Too Many Requests",
            code: "RATE_LIMITED",
            message: "Too many updates. Please try again in a minute.",
          },
          429,
          { "Retry-After": "60" },
        );
      }
    } catch (error) {
      // A rate-limiter outage must not take the endpoint down.
      console.error("Rate limit check failed:", error);
    }
  }

  // Reject oversized bodies before buffering them into memory.
  const contentLength = Number(req.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > MAX_BODY_BYTES) {
    return errorJson(
      {
        error: "Payload Too Large",
        code: "PAYLOAD_TOO_LARGE",
        message: "Request body is too large.",
      },
      413,
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return badRequest("Request body must be valid JSON.");
  }

  const validated = validateWakeupConfigInput(body);
  if (!validated.ok) {
    return badRequest(validated.message, validated.field);
  }

  const input = validated.value;

  try {
    const supabase = await createServerClient();

    // Verify every selected account belongs to the caller. RLS already blocks
    // cross-user writes to wakeup_configs, and a database trigger re-checks
    // ownership, but checking here turns it into a clean 404 instead of a
    // constraint error.
    if (input.selectedAccountIds.length > 0) {
      const { data: ownedAccounts, error: accountsError } = await supabase
        .from("google_accounts")
        .select("id")
        .in("id", input.selectedAccountIds)
        .eq("clerk_user_id", userId);

      if (accountsError) {
        return internalError("save wakeup config", accountsError);
      }

      if ((ownedAccounts?.length ?? 0) !== input.selectedAccountIds.length) {
        return errorJson(
          {
            error: "Not Found",
            code: "ACCOUNT_NOT_FOUND",
            message:
              "One or more selected accounts were not found or you don't have permission to use them.",
          },
          404,
        );
      }
    }

    const config = await saveWakeupConfig(supabase, userId, input);
    return NextResponse.json({ config });
  } catch (error) {
    return internalError("save wakeup config", error);
  }
}
