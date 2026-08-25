import { auth } from "@clerk/nextjs/server";
import { type NextRequest, NextResponse } from "next/server";
import { errorJson, internalError, unauthorized } from "@/lib/api/accounts";
import { createServerClient } from "@/lib/supabase/server";
import type { WakeupLogEntry } from "@/lib/types/wakeup";
import { isUuid } from "@/lib/utils";

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

type LogRow = {
  id: string;
  account_id: string | null;
  model_id: string;
  trigger_source: string;
  success: boolean;
  duration_ms: number | null;
  error: string | null;
  response_preview: string | null;
  created_at: string;
};

function toEntry(row: LogRow): WakeupLogEntry {
  return {
    id: row.id,
    accountId: row.account_id,
    modelId: row.model_id,
    triggerSource: (["manual", "scheduled", "quota_reset"] as const).includes(
      row.trigger_source as "manual",
    )
      ? (row.trigger_source as WakeupLogEntry["triggerSource"])
      : "manual",
    success: row.success,
    durationMs: row.duration_ms,
    error: row.error,
    responsePreview: row.response_preview,
    createdAt: row.created_at,
  };
}

export async function GET(req: NextRequest) {
  const { userId: authUserId } = await auth();
  if (!authUserId) return unauthorized();
  const userId = authUserId;

  const { searchParams } = new URL(req.url);

  const rawLimit = Number(searchParams.get("limit") ?? DEFAULT_LIMIT);
  const limit =
    Number.isInteger(rawLimit) && rawLimit >= 1 && rawLimit <= MAX_LIMIT
      ? rawLimit
      : DEFAULT_LIMIT;

  const rawOffset = Number(searchParams.get("offset") ?? 0);
  const offset = Number.isInteger(rawOffset) && rawOffset >= 0 ? rawOffset : 0;

  // RLS already scopes every read to the calling user's own logs; the
  // explicit clerk_user_id equality keeps that invariant visible here.
  let query = (await createServerClient())
    .from("wakeup_logs")
    .select("*")
    .eq("clerk_user_id", userId);

  const account = searchParams.get("account");
  if (account !== null && account !== "") {
    if (!isUuid(account)) {
      return errorJson(
        {
          error: "Bad Request",
          code: "VALIDATION_ERROR",
          message: "account must be a valid account ID.",
        },
        400,
      );
    }
    query = query.eq("account_id", account);
  }

  const status = searchParams.get("status");
  if (status !== null && status !== "") {
    if (status !== "success" && status !== "failed") {
      return errorJson(
        {
          error: "Bad Request",
          code: "VALIDATION_ERROR",
          message: "status must be 'success' or 'failed'.",
        },
        400,
      );
    }
    query = query.eq("success", status === "success");
  }

  try {
    const [logsResult, stats] = await Promise.all([
      query
        .order("created_at", { ascending: false })
        .range(offset, offset + limit - 1),
      computeStats(),
    ]);

    if (logsResult.error) {
      return internalError("load wakeup history", logsResult.error);
    }

    return NextResponse.json({
      logs: (logsResult.data ?? []).map(toEntry),
      stats,
    });
  } catch (err) {
    return internalError("load wakeup history", err);
  }

  /** Success-rate rollups for the last 24 hours and 7 days. */
  async function computeStats() {
    const supabase = await createServerClient();
    const now = Date.now();
    const dayAgo = new Date(now - 24 * 60 * 60 * 1000).toISOString();
    const weekAgo = new Date(now - 7 * 24 * 60 * 60 * 1000).toISOString();

    const windows = [
      { key: "24h" as const, since: dayAgo },
      { key: "7d" as const, since: weekAgo },
    ];

    const results = await Promise.all(
      windows.map(async ({ key, since }) => {
        const [totalRes, okRes] = await Promise.all([
          supabase
            .from("wakeup_logs")
            .select("id", { count: "exact", head: true })
            .eq("clerk_user_id", userId)
            .gte("created_at", since),
          supabase
            .from("wakeup_logs")
            .select("id", { count: "exact", head: true })
            .eq("clerk_user_id", userId)
            .eq("success", true)
            .gte("created_at", since),
        ]);
        return [
          key,
          {
            total: totalRes.count ?? 0,
            succeeded: okRes.count ?? 0,
          },
        ] as const;
      }),
    );

    const byKey = Object.fromEntries(results);
    return {
      total24h: byKey["24h"].total,
      succeeded24h: byKey["24h"].succeeded,
      total7d: byKey["7d"].total,
      succeeded7d: byKey["7d"].succeeded,
    };
  }
}
