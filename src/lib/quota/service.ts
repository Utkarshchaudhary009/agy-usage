import "server-only";

import {
  fetchAvailableModels,
  loadCodeAssist,
} from "../google/cloudcode-client";
import { parseQuotaSnapshot } from "../google/parser";
import { resolveProjectId } from "../google/project-resolver";
import { getValidAccessToken } from "../google/token-manager";
import { createServerClient, createServiceClient } from "../supabase/server";
import type { QuotaSnapshot } from "../types/quota";
import { saveSnapshot } from "./history";

const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

export async function fetchQuotaForAccount(
  accountId: string,
  options?: { asBackgroundJob?: boolean },
): Promise<QuotaSnapshot> {
  const supabase = options?.asBackgroundJob
    ? createServiceClient()
    : await createServerClient();

  // Get account info to include email in snapshot
  const { data: account, error: accountError } = await supabase
    .from("google_accounts")
    .select("email")
    .eq("id", accountId)
    .single();

  if (accountError || !account) {
    throw new Error(`Account not found: ${accountError?.message}`);
  }

  const token = await getValidAccessToken(accountId, options);
  const projectId = await resolveProjectId(accountId, options);

  const [codeAssist, modelsResponse] = await Promise.all([
    loadCodeAssist(token, accountId),
    fetchAvailableModels(token, accountId, projectId),
  ]);

  const snapshot = parseQuotaSnapshot(
    codeAssist,
    modelsResponse,
    account.email,
    accountId,
  );
  return snapshot;
}

export async function getCachedQuota(
  accountId: string,
): Promise<{ snapshot: QuotaSnapshot; fresh: boolean } | null> {
  const supabase = await createServerClient();

  const { data, error } = await supabase
    .from("quota_cache")
    .select("snapshot, cached_at")
    .eq("account_id", accountId)
    .single();

  if (error || !data) {
    return null;
  }

  const snapshot = data.snapshot as unknown as QuotaSnapshot;
  const cachedAt = new Date(data.cached_at).getTime();
  const fresh = Date.now() - cachedAt < CACHE_TTL_MS;

  return { snapshot, fresh };
}

async function saveToCache(accountId: string, snapshot: QuotaSnapshot) {
  const supabase = await createServerClient();

  const { error } = await supabase.from("quota_cache").upsert({
    account_id: accountId,
    snapshot: snapshot as any,
    cached_at: new Date().toISOString(),
  });

  if (error) {
    console.error("Failed to save quota to cache:", error);
  }
}

export async function getQuota(
  accountId: string,
  forceRefresh = false,
): Promise<QuotaSnapshot> {
  if (!forceRefresh) {
    const cached = await getCachedQuota(accountId);
    if (cached && cached.fresh) {
      return cached.snapshot;
    }
  }

  const snapshot = await fetchQuotaForAccount(accountId);
  await saveToCache(accountId, snapshot);
  // Also append to the historical table for charts/analytics
  await saveSnapshot(accountId, snapshot).catch((err) => {
    console.error(`Failed to save history for ${accountId}:`, err);
  });
  return snapshot;
}

export async function getQuotaAllAccounts(
  clerkUserId: string,
  forceRefresh = false,
): Promise<QuotaSnapshot[]> {
  const supabase = await createServerClient();

  const { data: accounts, error } = await supabase
    .from("google_accounts")
    .select("id")
    .eq("clerk_user_id", clerkUserId)
    .eq("is_active", true);

  if (error) {
    throw new Error(`Failed to fetch accounts: ${error.message}`);
  }

  if (!accounts) {
    return [];
  }

  const snapshots = await Promise.all(
    accounts.map((acc) =>
      getQuota(acc.id, forceRefresh).catch((err) => {
        console.error(`Failed to fetch quota for account ${acc.id}`, err);
        return null;
      }),
    ),
  );

  return snapshots.filter((s): s is QuotaSnapshot => s !== null);
}
