import { cache } from "react";
import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { createServerClient, createServiceClient } from "@/lib/supabase/server";
import type { Database, TokenRefreshLease } from "@/lib/types/database";
import type { GoogleTokenResponse } from "@/lib/types/google";
import { GOOGLE_OAUTH, OAuthConfigError } from "./oauth-config";

// Refresh token 5 minutes before expiry
const EXPIRY_BUFFER_MS = 5 * 60 * 1000;

/** Hard ceiling on one read -> exchange -> persist sequence. */
const REFRESH_DEADLINE_MS = 25_000;
/**
 * Database lease TTL. Must exceed REFRESH_DEADLINE_MS so a holder that is still
 * working never has its lease reaped out from under it, but stay small enough
 * that a crashed holder unblocks the account quickly.
 */
const LEASE_TTL_SECONDS = 30;
/** Backoff bounds while waiting for another instance's lease to clear. */
const LEASE_POLL_BASE_MS = 200;
const LEASE_POLL_MAX_MS = 2_000;
/** Independent budget for the lease release, which must run even after abort. */
const LEASE_RELEASE_TIMEOUT_MS = 5_000;
/** Independent budget for the "this refresh token is dead" write. */
const REVOKE_WRITE_TIMEOUT_MS = 5_000;
/** Per-attempt budget for the Google token endpoint. */
const GOOGLE_TOKEN_TIMEOUT_MS = 10_000;

/** Permanent failure: Google rejected the grant, the account must re-auth. */
export class TokenRefreshError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TokenRefreshError";
  }
}

/**
 * Transient failure: the refresh sequence exceeded its deadline and was
 * aborted. Deliberately NOT a TokenRefreshError — callers surface those as
 * "re-authenticate this account", which would be wrong for a network stall.
 */
export class TokenRefreshTimeoutError extends Error {
  constructor(accountId: string, timeoutMs: number) {
    super(
      `Token refresh for account ${accountId} exceeded ${timeoutMs}ms and was aborted`,
    );
    this.name = "TokenRefreshTimeoutError";
  }
}

/** Options shared by the account-scoped token helpers. */
export interface TokenAccessOptions {
  /**
   * Set to true when calling from a background job (Inngest) that has no Clerk
   * request context, so the service-role client is used instead of RLS.
   */
  asBackgroundJob?: boolean;
}

type TokenClient = SupabaseClient<Database>;

// First-level, per-process dedupe of token refreshes. Concurrent callers in the
// *same* instance (parallel requests, Inngest fan-out landing on one lambda)
// that all observe an expired token share a single in-flight refresh instead of
// each paying a database round-trip to discover they lost the race.
//
// This is intentionally process-global rather than request-scoped: React's
// cache() only dedupes within a single request, and the herd we care about is
// made of *separate* requests. Only the resulting access token is shared —
// never a request-scoped Supabase client — so no caller's auth context can
// leak into another's.
//
// It is only an optimization. The correctness guarantee lives in the database
// lease below, because separate Vercel instances do not share this map.
const refreshLocks = new Map<string, Promise<string>>();

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(signal.reason);
      return;
    }
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal.reason);
    };
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

/**
 * Runs a refresh sequence under a single cancellable deadline.
 *
 * The signal is threaded through every Supabase round-trip and the Google
 * fetch, so a stalled dependency aborts the whole sequence instead of parking
 * every joined caller forever.
 *
 * Note the deliberate absence of `Promise.race()`: racing would resolve the
 * caller while the underlying rotation is still running, which is exactly the
 * situation the lock exists to prevent. Instead the operation is aborted and
 * then awaited to completion.
 */
async function withRefreshDeadline(
  accountId: string,
  operation: (signal: AbortSignal) => Promise<string>,
): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort(
      new TokenRefreshTimeoutError(accountId, REFRESH_DEADLINE_MS),
    );
  }, REFRESH_DEADLINE_MS);

  try {
    return await operation(controller.signal);
  } catch (err) {
    // Normalize whatever the aborted dependency threw (DOMException,
    // PostgrestError, ...) into one recognizable timeout error.
    if (controller.signal.aborted) {
      throw controller.signal.reason instanceof Error
        ? controller.signal.reason
        : new TokenRefreshTimeoutError(accountId, REFRESH_DEADLINE_MS);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Opportunistic refresh: joins an in-flight refresh for the same account in
 * this process, otherwise starts one.
 *
 * The lock entry is removed only after the underlying sequence has fully
 * settled (including an aborted one finishing its unwind), so a later caller
 * can never start a second exchange while the first is still mid-rotation.
 */
function refreshAccessToken(accountId: string): Promise<string> {
  const inFlight = refreshLocks.get(accountId);
  if (inFlight) {
    return inFlight;
  }

  const promise = withRefreshDeadline(accountId, (signal) =>
    refreshUnderLease(accountId, false, signal),
  ).finally(() => {
    refreshLocks.delete(accountId);
  });

  refreshLocks.set(accountId, promise);
  return promise;
}

function isStillValid(expiresAt: string | null | undefined): boolean {
  if (!expiresAt) return false;
  return Date.now() < new Date(expiresAt).getTime() - EXPIRY_BUFFER_MS;
}

async function releaseLease(
  service: TokenClient,
  accountId: string,
  lockToken: string,
): Promise<void> {
  try {
    // Deliberately not the sequence signal: the lease must be released even
    // when the sequence was aborted, so it gets its own small budget.
    const { error } = await service
      .rpc("release_token_refresh_lease", {
        p_account_id: accountId,
        p_lock_token: lockToken,
      })
      .abortSignal(AbortSignal.timeout(LEASE_RELEASE_TIMEOUT_MS));

    if (error) {
      throw new Error(error.message);
    }
  } catch (err) {
    // Best effort: the lease carries a TTL, so a failed release self-heals.
    console.error("Failed to release token refresh lease", {
      accountId,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

/**
 * Serializes the read -> Google exchange -> persist sequence across *all*
 * instances using a database lease, then performs it.
 *
 * A process-local Map cannot provide this guarantee: on the documented Vercel
 * deployment, concurrent HTTP requests and Inngest steps run on separate
 * instances that share no memory. Without a shared lease two of them can read
 * the same refresh token and exchange it in parallel; Google rotates the token
 * for the winner and answers the loser with `invalid_grant`, which this module
 * would otherwise record as a revoked account.
 *
 * The refresh token is read *by the lease grant itself* (inside the same
 * transaction that records the lease) rather than beforehand, so a caller can
 * never replay a token that a concurrent refresh has already rotated.
 *
 * @param force - mint a new token even if the persisted one is still valid.
 */
async function refreshUnderLease(
  accountId: string,
  force: boolean,
  signal: AbortSignal,
): Promise<string> {
  const service = createServiceClient();

  // Once we have waited on another instance's in-flight refresh, the token it
  // persists is just as newly minted as one we would produce ourselves, so a
  // forced caller can (and should) accept it instead of burning a second
  // exchange.
  let joinedInFlight = false;
  let attempt = 0;

  for (;;) {
    signal.throwIfAborted();

    const { data, error } = await service
      .rpc("acquire_token_refresh_lease", {
        p_account_id: accountId,
        p_ttl_seconds: LEASE_TTL_SECONDS,
        p_expiry_buffer_seconds: Math.ceil(EXPIRY_BUFFER_MS / 1000),
        p_force: force && !joinedInFlight,
      })
      .abortSignal(signal);

    if (error) {
      throw new Error(
        `Failed to acquire token refresh lease: ${error.message}`,
      );
    }

    const lease = data as TokenRefreshLease | null;
    if (!lease) {
      throw new Error("Failed to acquire token refresh lease: empty response");
    }

    // Another instance refreshed while we were queued.
    if (lease.outcome === "fresh") {
      if (!lease.access_token) {
        throw new Error("Tokens not found for this account");
      }
      return lease.access_token;
    }

    if (lease.outcome === "locked") {
      joinedInFlight = true;
      attempt += 1;
      await sleep(
        Math.min(LEASE_POLL_BASE_MS * 2 ** (attempt - 1), LEASE_POLL_MAX_MS),
        signal,
      );
      continue;
    }

    try {
      if (!lease.refresh_token) {
        throw new TokenRefreshError(
          "No refresh token available to renew access token",
        );
      }
      return await performTokenRefresh(
        service,
        accountId,
        lease.refresh_token,
        signal,
      );
    } finally {
      await releaseLease(service, accountId, lease.lock_token);
    }
  }
}

/**
 * Exchanges the refresh token for a new access token via Google, persists the
 * new tokens to the Vault, and updates the account's token status.
 * Throws TokenRefreshError for permanent failures (revoked/invalid grants).
 *
 * Must only be called while holding the account's refresh lease.
 */
async function performTokenRefresh(
  supabase: TokenClient,
  accountId: string,
  refreshToken: string,
  signal: AbortSignal,
): Promise<string> {
  // Read OAuth credentials up front: a missing env var is a deployment defect,
  // not a transient fault, so the OAuthConfigError must surface immediately
  // instead of being retried with backoff and reported as a network error by
  // the loop below.
  const clientId = GOOGLE_OAUTH.clientId;
  const clientSecret = GOOGLE_OAUTH.clientSecret;

  // Refresh via Google API with retry logic
  let tokenResponse: Response | null = null;
  const MAX_RETRIES = 2; // initial attempt + 1 retry

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      tokenResponse = await fetch(GOOGLE_OAUTH.tokenUrl, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        // Bound each attempt so a stalled Google response cannot hang callers,
        // and honour the sequence deadline so an abort unwinds immediately.
        signal: AbortSignal.any([
          signal,
          AbortSignal.timeout(GOOGLE_TOKEN_TIMEOUT_MS),
        ]),
        body: new URLSearchParams({
          client_id: clientId,
          client_secret: clientSecret,
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
          // Own timeout rather than the sequence signal: losing this write
          // would leave a dead account looking healthy and re-refreshing
          // forever.
          await supabase
            .from("google_accounts")
            .update({ token_status: "revoked" })
            .eq("id", accountId)
            .abortSignal(AbortSignal.timeout(REVOKE_WRITE_TIMEOUT_MS));
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
            await sleep(1000 * attempt, signal);
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

      // Misconfiguration and deadline aborts are not transient: retrying only
      // delays the real error and disguises it as a network failure.
      if (err instanceof OAuthConfigError || signal.aborted) {
        throw err;
      }

      if (
        attempt === MAX_RETRIES &&
        err instanceof Error &&
        err.message.startsWith("Failed to refresh token:")
      ) {
        throw err; // Don't wrap our deliberate terminal error messages
      }

      if (attempt < MAX_RETRIES) {
        await sleep(1000 * attempt, signal);
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
  const { error: vaultError } = await supabase
    .rpc("upsert_google_tokens", {
      p_account_id: accountId,
      p_access_token: data.access_token,
      p_refresh_token: finalRefreshToken,
      p_expires_at: newExpiresAt,
    })
    .abortSignal(signal);

  if (vaultError) {
    throw new Error(`Failed to save refreshed tokens: ${vaultError.message}`);
  }

  // Update account status to active if it was expired
  await supabase
    .from("google_accounts")
    .update({ token_status: "active", last_used_at: new Date().toISOString() })
    .eq("id", accountId)
    .abortSignal(signal);

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

  if (isStillValid(expires_at) && access_token) {
    // 2a. Still valid, return decrypted access token
    return access_token;
  }

  // 2b. Expired as far as this (unsynchronized) read can tell. The refresh path
  // re-reads the token state inside the lease before exchanging anything, so a
  // caller that queued behind a refresh which has since landed gets the
  // persisted token instead of triggering a duplicate Google exchange.
  //
  // Ownership was already enforced by the RLS-scoped account lookup above and
  // get_valid_token_metadata's internal check, so the service-role refresh path
  // is safe.
  return refreshAccessToken(accountId);
});

/**
 * Gets a valid access token for the given account, refreshing it if needed.
 *
 * @param accountId - The ID of the Google account
 * @param options - Set asBackgroundJob to true when calling from Inngest to bypass RLS
 */
export function getValidAccessToken(
  accountId: string,
  options?: TokenAccessOptions,
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
 * It deliberately bypasses the opportunistic per-process lock — that lock can
 * hand back an already-persisted token — and goes straight to the distributed
 * lease, which understands the "must be newly minted" requirement. It still
 * joins a refresh that another caller already has in flight rather than issuing
 * a duplicate request to Google, because that refresh's result is newly minted
 * either way.
 *
 * Ownership is verified via an RLS-scoped lookup before the service-role
 * token path is used (the lease RPC is service-role-only).
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

  return withRefreshDeadline(accountId, (signal) =>
    refreshUnderLease(accountId, true, signal),
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

  return isStillValid(data.expires_at);
});

/**
 * Checks if an account's token is currently valid without refreshing it.
 *
 * @param accountId - The ID of the Google account
 * @param options - Set asBackgroundJob to true when calling from Inngest to bypass RLS
 */
export function isTokenValid(
  accountId: string,
  options?: TokenAccessOptions,
): Promise<boolean> {
  return isTokenValidCached(accountId, options?.asBackgroundJob === true);
}

/**
 * Revokes an account's token and removes it from the database.
 * This sets token_status to revoked and marks the tokens as invalid.
 */
export async function revokeAccount(
  accountId: string,
  options?: TokenAccessOptions,
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
