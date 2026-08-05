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
 * @param accountId - The ID of the Google account
 * @param options - Set asBackgroundJob to true when calling from Inngest to bypass RLS
 */
export const getValidAccessToken = cache(async function getValidAccessToken(
  accountId: string,
  options?: { asBackgroundJob?: boolean },
): Promise<string> {
  const supabase = options?.asBackgroundJob
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

  // 2b. Expired, we need to refresh. get_decrypted_refresh_token is
  // service-role-only; ownership was already enforced by the RLS-scoped
  // account lookup above and get_valid_token_metadata's internal check.
  const tokenClient = createServiceClient();
  const { data: refreshToken, error: refreshRpcError } = await tokenClient.rpc(
    "get_decrypted_refresh_token",
    { p_account_id: accountId },
  );

  if (refreshRpcError || !refreshToken) {
    throw new Error("No refresh token available to renew access token");
  }

  return withRefreshLock(accountId, () =>
    performTokenRefresh(tokenClient, accountId, refreshToken),
  );
});

/**
 * Forces an immediate token refresh against Google, regardless of expiry.
 * Updates the stored tokens and resets the account's token status to active
 * (or revoked if Google rejects the refresh token). Not cached: every call
 * hits the token endpoint.
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

  const service = createServiceClient();
  const { data: refreshToken, error: refreshRpcError } = await service.rpc(
    "get_decrypted_refresh_token",
    { p_account_id: accountId },
  );

  if (refreshRpcError || !refreshToken) {
    throw new Error("No refresh token available to renew access token");
  }

  return withRefreshLock(accountId, () =>
    performTokenRefresh(service, accountId, refreshToken),
  );
}

/**
 * Checks if an account's token is currently valid without refreshing it.
 */
export const isTokenValid = cache(async function isTokenValid(
  accountId: string,
  options?: { asBackgroundJob?: boolean },
): Promise<boolean> {
  const supabase = options?.asBackgroundJob
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
