import { cache } from "react";
import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { createServerClient, createServiceClient } from "@/lib/supabase/server";
import type { Database } from "@/lib/types/database";
import type { GoogleTokenResponse } from "@/lib/types/google";
import { GOOGLE_OAUTH } from "./oauth-config";

// Refresh token 5 minutes before expiry
const EXPIRY_BUFFER_MS = 5 * 60 * 1000;

export class TokenRefreshError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TokenRefreshError";
  }
}

type TokenClient = SupabaseClient<Database>;

// Serialize token refreshes per account so concurrent callers (parallel
// requests or Inngest fan-out) that all observe an expired token don't each
// independently hit Google. Without this lock we'd get a thundering herd that
// wastes refresh-token quota and, on providers that rotate refresh tokens,
// can invalidate a token another in-flight refresh is still using.
//
// This is intentionally process-global rather than request-scoped: React's
// cache() only dedupes within a single request, and the herd we care about is
// made of *separate* requests. Only the resulting access token is shared —
// never a request-scoped Supabase client — so no caller's auth context can
// leak into another's.
const refreshLocks = new Map<string, Promise<string>>();

function withRefreshLock(
  accountId: string,
  refresher: () => Promise<string>,
): Promise<string> {
  const inFlight = refreshLocks.get(accountId);
  if (inFlight) {
    return inFlight;
  }
  const promise = refresher().finally(() => {
    refreshLocks.delete(accountId);
  });
  refreshLocks.set(accountId, promise);
  return promise;
}

/**
 * Reads the stored refresh token with the service role and exchanges it.
 *
 * Callers must have already verified ownership of `accountId`:
 * get_decrypted_refresh_token is service-role-only and performs no RLS check.
 *
 * The read lives inside this function (and therefore inside the refresh lock)
 * on purpose. If it were hoisted above the lock, a caller could read the
 * refresh token, lose the race to another refresh that rotates it, and then
 * replay the now-stale token — which Google answers with `invalid_grant`,
 * causing us to wrongly mark a healthy account as revoked.
 */
async function readAndExchangeRefreshToken(accountId: string): Promise<string> {
  const service = createServiceClient();
  const { data: refreshToken, error: refreshRpcError } = await service.rpc(
    "get_decrypted_refresh_token",
    { p_account_id: accountId },
  );

  if (refreshRpcError || !refreshToken) {
    throw new Error("No refresh token available to renew access token");
  }

  return performTokenRefresh(service, accountId, refreshToken);
}

/**
 * Exchanges the refresh token for a new access token via Google, persists the
 * new tokens to the Vault, and updates the account's token status.
 * Throws TokenRefreshError for permanent failures (revoked/invalid grants).
 */
async function performTokenRefresh(
  supabase: TokenClient,
  accountId: string,
  refreshToken: string,
): Promise<string> {
  // Refresh via Google API with retry logic
  let tokenResponse: Response | null = null;
  const MAX_RETRIES = 2; // initial attempt + 1 retry

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      tokenResponse = await fetch(GOOGLE_OAUTH.tokenUrl, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        // Bound each attempt so a stalled Google response cannot hang callers.
        signal: AbortSignal.timeout(10_000),
        body: new URLSearchParams({
          client_id: GOOGLE_OAUTH.clientId,
          client_secret: GOOGLE_OAUTH.clientSecret,
          refresh_token: refreshToken,
          grant_type: "refresh_token",
        }),
      });

      if (!tokenResponse.ok) {
        const errorData = (await tokenResponse
          .json()
          .catch(() => ({}))) as Record<string, unknown>;

        // Check if permanent error (revoked)
        if (errorData.error === "invalid_grant") {
          await supabase
            .from("google_accounts")
            .update({ token_status: "revoked" })
            .eq("id", accountId);
          throw new TokenRefreshError(
            "Refresh token has been revoked or is invalid",
          );
        }

        // For 4xx errors, do not retry
        if (tokenResponse.status >= 400 && tokenResponse.status < 500) {
          throw new TokenRefreshError(
            `Failed to refresh token: ${tokenResponse.status} ${JSON.stringify(errorData)}`,
          );
        }

        // For 5xx errors, we can retry
        if (tokenResponse.status >= 500) {
          if (attempt < MAX_RETRIES) {
            await new Promise((resolve) => setTimeout(resolve, 1000 * attempt));
            continue;
          }
          // Final attempt failed
          throw new Error(`Failed to refresh token: ${tokenResponse.status}`);
        }

        throw new Error(`Failed to refresh token: ${tokenResponse.status}`);
      }

      // If ok, break out of retry loop
      break;
    } catch (err) {
      if (err instanceof TokenRefreshError) {
        throw err; // Don't retry permanent errors
      }

      if (
        attempt === MAX_RETRIES &&
        err instanceof Error &&
        err.message.startsWith("Failed to refresh token:")
      ) {
        throw err; // Don't wrap our deliberate terminal error messages
      }

      if (attempt < MAX_RETRIES) {
        await new Promise((resolve) => setTimeout(resolve, 1000 * attempt));
        continue;
      }
      throw new Error(
        `Network or unexpected error during token refresh: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  if (!tokenResponse) {
    throw new Error("Failed to fetch token: response is null");
  }

  const data = (await tokenResponse.json()) as GoogleTokenResponse;

  // Calculate new expiry
  const newExpiresAt = new Date(
    Date.now() + (Number(data.expires_in) || 3599) * 1000,
  ).toISOString();

  // If a new refresh token wasn't provided, keep the old one
  const finalRefreshToken = data.refresh_token || refreshToken;

  // Save new tokens securely
  const { error: vaultError } = await supabase.rpc("upsert_google_tokens", {
    p_account_id: accountId,
    p_access_token: data.access_token,
    p_refresh_token: finalRefreshToken,
    p_expires_at: newExpiresAt,
  });

  if (vaultError) {
    throw new Error(`Failed to save refreshed tokens: ${vaultError.message}`);
  }

  // Update account status to active if it was expired
  await supabase
    .from("google_accounts")
    .update({ token_status: "active", last_used_at: new Date().toISOString() })
    .eq("id", accountId);

  return data.access_token;
}

/**
 * Gets a valid access token for the given account.
 * If the current token is expired, it will automatically refresh it and update the database.
 *
 * Note: results are memoized per request via React cache(). Do not call this
 * after forceRefreshToken() for the same account within one request — the
 * memoized (pre-refresh) token would be returned.
 *
 * Only primitive arguments are passed to the memoized function: React's cache()
 * matches arguments by reference, so an options *object* would produce a fresh
 * cache entry on every call and silently disable memoization.
 */
const getValidAccessTokenCached = cache(async function getValidAccessToken(
  accountId: string,
  asBackgroundJob: boolean,
): Promise<string> {
  const supabase = asBackgroundJob
    ? createServiceClient()
    : await createServerClient();

  const { data: accountData } = await supabase
    .from("google_accounts")
    .select("token_status")
    .eq("id", accountId)
    .single();

  if (accountData?.token_status === "revoked") {
    throw new TokenRefreshError("Refresh token has been revoked or is invalid");
  }

  // 1. Get token metadata and access token securely in one round-trip
  const { data: tokenMeta, error: metaError } = await supabase.rpc(
    "get_valid_token_metadata",
    { p_account_id: accountId },
  );

  if (metaError || !tokenMeta) {
    throw new Error(
      `Tokens not found for this account or decryption failed: ${metaError?.message || "No data"}`,
    );
  }

  const { access_token, expires_at } = tokenMeta as {
    access_token: string;
    expires_at: string;
  };

  if (!expires_at) {
    throw new Error("Tokens not found for this account");
  }

  const expiresAt = new Date(expires_at).getTime();
  const isExpired = Date.now() >= expiresAt - EXPIRY_BUFFER_MS;

  if (!isExpired && access_token) {
    // 2a. Still valid, return decrypted access token
    return access_token;
  }

  // 2b. Expired, we need to refresh. Ownership was already enforced by the
  // RLS-scoped account lookup above and get_valid_token_metadata's internal
  // check, so the service-role refresh path below is safe.
  return withRefreshLock(accountId, () =>
    readAndExchangeRefreshToken(accountId),
  );
});

/**
 * Gets a valid access token for the given account, refreshing it if needed.
 *
 * @param accountId - The ID of the Google account
 * @param options - Set asBackgroundJob to true when calling from Inngest to bypass RLS
 */
export function getValidAccessToken(
  accountId: string,
  options?: { asBackgroundJob?: boolean },
): Promise<string> {
  return getValidAccessTokenCached(
    accountId,
    options?.asBackgroundJob === true,
  );
}

/**
 * Forces an immediate token refresh against Google, regardless of expiry.
 * Updates the stored tokens and resets the account's token status to active
 * (or revoked if Google rejects the refresh token).
 *
 * Not memoized: unlike getValidAccessToken this never returns a cached token.
 * It does, however, join an already in-flight refresh for the same account
 * rather than issuing a duplicate request to Google — the token it hands back
 * is newly minted either way.
 *
 * Ownership is verified via an RLS-scoped lookup before the service-role
 * token path is used (get_decrypted_refresh_token is service-role-only).
 *
 * @param accountId - The ID of the Google account
 */
export async function forceRefreshToken(accountId: string): Promise<string> {
  const server = await createServerClient();

  const { data: account } = await server
    .from("google_accounts")
    .select("id")
    .eq("id", accountId)
    .single();

  if (!account) {
    throw new Error("Not authorized to refresh this account");
  }

  return withRefreshLock(accountId, () =>
    readAndExchangeRefreshToken(accountId),
  );
}

/**
 * Checks if an account's token is currently valid without refreshing it.
 *
 * Memoized per request via React cache() on primitive arguments only — see the
 * note on getValidAccessTokenCached.
 */
const isTokenValidCached = cache(async function isTokenValid(
  accountId: string,
  asBackgroundJob: boolean,
): Promise<boolean> {
  const supabase = asBackgroundJob
    ? createServiceClient()
    : await createServerClient();

  const { data: account, error: accountError } = await supabase
    .from("google_accounts")
    .select("token_status")
    .eq("id", accountId)
    .single();

  if (accountError || !account || account.token_status === "revoked") {
    return false;
  }

  const { data, error } = await supabase
    .from("google_tokens")
    .select("expires_at")
    .eq("account_id", accountId)
    .single();

  if (error || !data) return false;

  const expiresAt = new Date(data.expires_at).getTime();
  return Date.now() < expiresAt - EXPIRY_BUFFER_MS;
});

/**
 * Checks if an account's token is currently valid without refreshing it.
 *
 * @param accountId - The ID of the Google account
 * @param options - Set asBackgroundJob to true when calling from Inngest to bypass RLS
 */
export function isTokenValid(
  accountId: string,
  options?: { asBackgroundJob?: boolean },
): Promise<boolean> {
  return isTokenValidCached(accountId, options?.asBackgroundJob === true);
}

/**
 * Revokes an account's token and removes it from the database.
 * This sets token_status to revoked and marks the tokens as invalid.
 */
export async function revokeAccount(
  accountId: string,
  options?: { asBackgroundJob?: boolean },
): Promise<void> {
  const supabase = options?.asBackgroundJob
    ? createServiceClient()
    : await createServerClient();

  if (!options?.asBackgroundJob) {
    const { error } = await supabase
      .from("google_accounts")
      .update({ token_status: "revoked" })
      .eq("id", accountId)
      .select("id")
      .single();

    if (error) {
      if (error.code === "PGRST116") {
        throw new Error("Not authorized to revoke this account");
      }
      throw new Error(`Failed to revoke account: ${error.message}`);
    }
  } else {
    const { error } = await supabase
      .from("google_accounts")
      .update({ token_status: "revoked" })
      .eq("id", accountId);

    if (error) {
      throw new Error(`Failed to revoke account: ${error.message}`);
    }
  }
}
