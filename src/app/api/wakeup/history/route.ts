import { auth } from "@clerk/nextjs/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { type NextRequest, NextResponse } from "next/server";
import { errorJson, internalError, unauthorized } from "@/lib/api/accounts";
import { createServerClient } from "@/lib/supabase/server";
import type { Database } from "@/lib/types/database";
import {
  TRIGGER_SOURCES,
  type WakeupHistoryStats,
  type WakeupLogEntry,
} from "@/lib/types/wakeup";
import { isUuid } from "@/lib/utils";
import { isWakeupModelId } from "@/lib/wakeup/models";

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;
const SORT_FIELDS = ["createdAt", "durationMs"] as const;
type SortField = (typeof SORT_FIELDS)[number];
const SORT_DIRECTIONS = ["asc", "desc"] as const;
type SortDirection = (typeof SORT_DIRECTIONS)[number];
// Pagination is client-driven at 50/page; a ceiling keeps arbitrary
// deep-offset scans from walking the whole index.
const MAX_OFFSET = 10_000;

type LogRow = Database["public"]["Tables"]["wakeup_logs"]["Row"];

const TRIGGER_SOURCE_SET = new Set<string>(TRIGGER_SOURCES);

function toEntry(row: LogRow): WakeupLogEntry {
  return {
    id: row.id,
    accountId: row.account_id,
    modelId: row.model_id,
    triggerSource: (
      TRIGGER_SOURCE_SET as Set<WakeupLogEntry["triggerSource"]>
    ).has(row.trigger_source)
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
  const { userId } = await auth();
  if (!userId) return unauthorized();

  const { searchParams } = new URL(req.url);

  const rawLimit = Number(searchParams.get("limit") ?? DEFAULT_LIMIT);
  const limit =
    Number.isInteger(rawLimit) && rawLimit >= 1 && rawLimit <= MAX_LIMIT
      ? rawLimit
      : DEFAULT_LIMIT;

  const rawOffset = Number(searchParams.get("offset") ?? 0);
  // Reject rather than silently rewriting: a clamped/reset offset would serve
  // page 1 to a caller asking for a deep page, hiding the truncation.
  if (!Number.isInteger(rawOffset) || rawOffset < 0 || rawOffset > MAX_OFFSET) {
    return validationFailed(
      `offset must be an integer between 0 and ${MAX_OFFSET}.`,
    );
  }
  const offset = rawOffset;

  const sortParam = searchParams.get("sort") ?? "createdAt";
  if (!SORT_FIELDS.includes(sortParam as SortField)) {
    return validationFailed("sort must be 'createdAt' or 'durationMs'.");
  }
  const directionParam = searchParams.get("dir") ?? "desc";
  if (!SORT_DIRECTIONS.includes(directionParam as SortDirection)) {
    return validationFailed("dir must be 'asc' or 'desc'.");
  }
  const ascending = directionParam === "asc";

  // RLS already scopes every read to the calling user's own logs; the
  // explicit clerk_user_id equality keeps that invariant visible here.
  let query = (await createServerClient())
    .from("wakeup_logs")
    .select("*")
    .eq("clerk_user_id", userId);

  const account = searchParams.get("account");
  if (account !== null && account !== "") {
    if (!isUuid(account)) {
      return validationFailed("account must be a valid account ID.");
    }
    query = query.eq("account_id", account);
  }

  const model = searchParams.get("model");
  if (model !== null && model !== "") {
    if (!isWakeupModelId(model)) {
      return validationFailed("model must be a supported wakeup model.");
    }
    query = query.eq("model_id", model);
  }

  const status = searchParams.get("status");
  if (status !== null && status !== "") {
    if (status !== "success" && status !== "failed") {
      return validationFailed("status must be 'success' or 'failed'.");
    }
    query = query.eq("success", status === "success");
  }

  try {
    const supabase = await createServerClient();
    // Server-side ordering keeps global sorts correct across offset pages
    // (client-side reordering would only sort the visible slice); null
    // durations sort last regardless of direction.
    const [logsResult, stats] = await Promise.all([
      query
        .order(sortParam === "durationMs" ? "duration_ms" : "created_at", {
          ascending,
          nullsFirst: false,
        })
        .range(offset, offset + limit - 1),
      computeStats(supabase, userId),
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
}

function validationFailed(message: string) {
  return errorJson(
    {
      error: "Bad Request",
      code: "VALIDATION_ERROR",
      message,
    },
    400,
  );
}

/** Success-rate rollups for the last 24 hours and 7 days. */
async function computeStats(
  supabase: SupabaseClient<Database>,
  userId: string,
): Promise<WakeupHistoryStats> {
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
      // supabase-js reports failures via error + null count rather than
      // throwing; propagating keeps zero-stats from masking an outage.
      if (totalRes.error || okRes.error || totalRes.count === null) {
        throw new Error(`Failed to count wakeup logs (${key})`);
      }
      return [
        key,
        {
          total: totalRes.count,
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
