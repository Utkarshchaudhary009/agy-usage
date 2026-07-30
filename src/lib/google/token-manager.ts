import { cache } from "react";
import "server-only";

import { createServerClient, createServiceClient } from "@/lib/supabase/server";
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

/**
 * Gets a valid access token for the given account.
 * If the current token is expired, it will automatically refresh it and update the database.
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

  // 2b. Expired, we need to refresh
  const { data: refreshToken, error: refreshRpcError } = await supabase.rpc(
    "get_decrypted_refresh_token",
    { p_account_id: accountId },
  );

  if (refreshRpcError || !refreshToken) {
    throw new Error("No refresh token available to renew access token");
  }

  // Refresh via Google API with retry logic
  let tokenResponse: Response | null = null;
  const MAX_RETRIES = 2; // initial attempt + 1 retry

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      tokenResponse = await fetch(GOOGLE_OAUTH.tokenUrl, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
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
        if (
          errorData.error === "invalid_grant" ||
          tokenResponse.status === 400 ||
          tokenResponse.status === 401
        ) {
          await supabase
            .from("google_accounts")
            .update({ token_status: "revoked" })
            .eq("id", accountId);
          throw new TokenRefreshError(
            "Refresh token has been revoked or is invalid",
          );
        }

        // For other 5xx or network-like errors, we can retry
        if (attempt < MAX_RETRIES && tokenResponse.status >= 500) {
          await new Promise((resolve) => setTimeout(resolve, 1000 * attempt));
          continue;
        }

        // For 4xx errors (other than 400/401 handled above), do not retry
        if (tokenResponse.status >= 400 && tokenResponse.status < 500) {
          throw new TokenRefreshError(
            `Failed to refresh token: ${tokenResponse.status} ${JSON.stringify(errorData)}`,
          );
        }

        throw new Error(`Failed to refresh token: ${tokenResponse.status}`);
      }

      // If ok, break out of retry loop
      break;
    } catch (err) {
      if (err instanceof TokenRefreshError) {
        throw err; // Don't retry permanent errors
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
});

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

    if (error && error.code === "PGRST116") {
      throw new Error("Not authorized to revoke this account");
    }
  } else {
    await supabase
      .from("google_accounts")
      .update({ token_status: "revoked" })
      .eq("id", accountId);
  }
}
