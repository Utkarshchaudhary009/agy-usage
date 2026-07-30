import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { getQuotaAllAccounts, getQuota } from "@/lib/quota/service";
import { createServerClient } from "@/lib/supabase/server";

// Simple in-memory rate limiting for refresh requests
// Maps userId -> timestamps of refresh requests
const refreshRateLimits = new Map<string, number[]>();
const RATE_LIMIT_WINDOW_MS = 60 * 1000;
const MAX_REFRESHES_PER_MIN = 10;

function checkRateLimit(userId: string): boolean {
  const now = Date.now();
  let timestamps = refreshRateLimits.get(userId) || [];

  // Filter out timestamps older than the window
  timestamps = timestamps.filter((t) => now - t < RATE_LIMIT_WINDOW_MS);

  if (timestamps.length >= MAX_REFRESHES_PER_MIN) {
    refreshRateLimits.set(userId, timestamps); // update map with cleaned timestamps
    return false;
  }

  timestamps.push(now);
  refreshRateLimits.set(userId, timestamps);

  // Cleanup occasionally for other users
  if (Math.random() < 0.1) {
    for (const [key, tsArray] of Array.from(refreshRateLimits.entries())) {
      const validTs = tsArray.filter((t) => now - t < RATE_LIMIT_WINDOW_MS);
      if (validTs.length === 0) {
        refreshRateLimits.delete(key);
      } else {
        refreshRateLimits.set(key, validTs);
      }
    }
  }

  return true;
}

export async function GET(req: NextRequest) {
  const { userId } = await auth();

  if (!userId) {
    return NextResponse.json(
      {
        error: "Unauthorized",
        code: "UNAUTHORIZED",
        message: "You must be logged in to view quota.",
      },
      { status: 401 },
    );
  }

  const { searchParams } = new URL(req.url);
  const accountId = searchParams.get("account");
  const refresh = searchParams.get("refresh") === "true";

  if (refresh) {
    if (!checkRateLimit(userId)) {
      return NextResponse.json(
        {
          error: "Rate Limit Exceeded",
          code: "RATE_LIMIT_EXCEEDED",
          message: "Too many force refreshes. Please try again in a minute.",
        },
        { status: 429 },
      );
    }
  }

  try {
    if (accountId) {
      // Validate account ownership
      const supabase = await createServerClient();
      const { data: account, error } = await supabase
        .from("google_accounts")
        .select("id")
        .eq("id", accountId)
        .eq("clerk_user_id", userId)
        .single();

      if (error || !account) {
        return NextResponse.json(
          {
            error: "Not Found",
            code: "ACCOUNT_NOT_FOUND",
            message:
              "Account not found or you don't have permission to access it.",
          },
          { status: 404 },
        );
      }

      const snapshot = await getQuota(accountId, refresh);
      return NextResponse.json({
        snapshots: [snapshot],
        cachedAt: snapshot.timestamp,
      });
    } else {
      const snapshots = await getQuotaAllAccounts(userId, refresh);
      const latestTimestamp =
        snapshots.length > 0
          ? snapshots
              .map((s) => new Date(s.timestamp).getTime())
              .sort((a, b) => b - a)[0]
          : Date.now();

      return NextResponse.json({
        snapshots,
        cachedAt: new Date(latestTimestamp).toISOString(),
      });
    }
  } catch (error: any) {
    console.error("Quota API Error:", error);
    return NextResponse.json(
      {
        error: "Internal Server Error",
        code: "INTERNAL_ERROR",
        message: error.message || "Failed to fetch quota data",
      },
      { status: 500 },
    );
  }
}
