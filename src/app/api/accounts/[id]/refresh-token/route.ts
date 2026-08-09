import { auth } from "@clerk/nextjs/server";
import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";
import { type NextRequest, NextResponse } from "next/server";
import { accountNotFound, getOwnedAccountId } from "@/lib/api/accounts";
import {
  errorJson,
  internalError,
  isRowNotFound,
  unauthorized,
} from "@/lib/api/responses";
import {
  forceRefreshToken,
  TokenRefreshError,
} from "@/lib/google/token-manager";
import { createServerClient } from "@/lib/supabase/server";

type RouteContext = { params: Promise<{ id: string }> };

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

export async function POST(_req: NextRequest, { params }: RouteContext) {
  const { userId } = await auth();
  if (!userId) {
    return unauthorized();
  }

  if (ratelimit) {
    try {
      const { success } = await ratelimit.limit(
        `ratelimit_token_refresh_${userId}`,
      );
      if (!success) {
        return errorJson(
          {
            error: "Rate Limit Exceeded",
            code: "RATE_LIMIT_EXCEEDED",
            message: "Too many token refreshes. Please try again in a minute.",
          },
          429,
          { "Retry-After": "60" },
        );
      }
    } catch (err) {
      console.error("Failed to check rate limit, failing open:", err);
    }
  }

  const { id } = await params;

  const supabase = await createServerClient();
  const { data: account, error: lookupError } = await getOwnedAccountId(
    supabase,
    userId,
    id,
  );
  // PGRST116 = no rows matched after RLS filtering: a genuine not-found.
  if (lookupError && !isRowNotFound(lookupError)) {
    return internalError("refresh token", lookupError);
  }

  if (!account) {
    return accountNotFound();
  }

  try {
    await forceRefreshToken(id);
  } catch (err) {
    if (err instanceof TokenRefreshError) {
      // Log the detail server-side, but keep the client response generic.
      console.error("Token refresh rejected by Google:", err.message);
      return errorJson(
        {
          error: "Token Refresh Failed",
          code: "TOKEN_REFRESH_FAILED",
          message:
            "Token refresh was rejected by Google. Please re-authenticate this account.",
        },
        400,
      );
    }

    return internalError("refresh token", err);
  }

  return NextResponse.json({ success: true });
}
