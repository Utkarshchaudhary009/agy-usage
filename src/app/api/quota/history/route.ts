import { auth } from "@clerk/nextjs/server";
import { type NextRequest, NextResponse } from "next/server";
import { getHistory, getModelHistory } from "@/lib/quota/history";
import { createServerClient } from "@/lib/supabase/server";

export async function GET(req: NextRequest) {
  const { userId } = await auth();

  if (!userId) {
    return NextResponse.json(
      {
        error: "Unauthorized",
        code: "UNAUTHORIZED",
        message: "You must be logged in to view history.",
      },
      { status: 401 },
    );
  }

  const { searchParams } = new URL(req.url);
  const accountId = searchParams.get("account");
  const accountsParam = searchParams.get("accounts");
  const fromParam = searchParams.get("from");
  const toParam = searchParams.get("to");
  const modelId = searchParams.get("model");

  if (!accountId && !accountsParam) {
    return NextResponse.json(
      {
        error: "Bad Request",
        code: "BAD_REQUEST",
        message: "account or accounts parameter is required",
      },
      { status: 400 },
    );
  }

  if (accountId && accountsParam) {
    return NextResponse.json(
      {
        error: "Bad Request",
        code: "BAD_REQUEST",
        message: "Provide either account or accounts, not both.",
      },
      { status: 400 },
    );
  }

  const accountIdsToFetch = Array.from(
    new Set(
      accountsParam ? accountsParam.split(",") : accountId ? [accountId] : [],
    ),
  );

  // Set default from/to if missing (default to last 7 days)
  const to = toParam ? new Date(toParam) : new Date();
  const from = fromParam
    ? new Date(fromParam)
    : new Date(to.getTime() - 7 * 24 * 60 * 60 * 1000);

  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || from > to) {
    return NextResponse.json(
      {
        error: "Bad Request",
        code: "BAD_REQUEST",
        message: "Invalid date range.",
      },
      { status: 400 },
    );
  }

  try {
    // Validate account ownership
    const supabase = await createServerClient();
    const { data: accountsData, error } = await supabase
      .from("google_accounts")
      .select("id")
      .in("id", accountIdsToFetch)
      .eq("clerk_user_id", userId);

    if (
      error ||
      !accountsData ||
      accountsData.length !== accountIdsToFetch.length
    ) {
      return NextResponse.json(
        {
          error: "Not Found",
          code: "ACCOUNT_NOT_FOUND",
          message:
            "One or more accounts not found or you don't have permission to access them.",
        },
        { status: 404 },
      );
    }

    if (modelId && accountId) {
      const history = await getModelHistory(accountId, modelId, from, to);
      return NextResponse.json({ history });
    } else {
      const history = await getHistory(accountIdsToFetch, from, to);
      return NextResponse.json({ history });
    }
  } catch (error) {
    console.error("History API Error:", error);
    return NextResponse.json(
      {
        error: "Internal Server Error",
        code: "INTERNAL_ERROR",
        message: "Failed to fetch history data",
      },
      { status: 500 },
    );
  }
}
