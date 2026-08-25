import { auth } from "@clerk/nextjs/server";
import { type NextRequest, NextResponse } from "next/server";
import { enforceRateLimit } from "@/lib/api/rate-limit";
import { getQuota, getQuotaAllAccounts } from "@/lib/quota/service";
import { createServerClient } from "@/lib/supabase/server";

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
    const limited = await enforceRateLimit({
      bucket: "quota_refresh",
      identifier: userId,
      limit: 10,
      window: "1 m",
      message: "Too many force refreshes. Please try again in a minute.",
    });
    if (limited) return limited;
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
  } catch (error) {
    console.error("Quota API Error:", error);
    return NextResponse.json(
      {
        error: "Internal Server Error",
        code: "INTERNAL_ERROR",
        message: "Failed to fetch quota data",
      },
      { status: 500 },
    );
  }
}
