import { auth } from "@clerk/nextjs/server";
import { cookies } from "next/headers";
import { type NextRequest, NextResponse } from "next/server";
import {
  assertGoogleOAuthConfig,
  GOOGLE_OAUTH,
} from "@/lib/google/oauth-config";
import { decryptToken as decryptState } from "@/lib/google/state-crypto";
import { createServiceClient } from "@/lib/supabase/server";
import type { GoogleTokenResponse, GoogleUserInfo } from "@/lib/types/google";

export async function GET(req: NextRequest): Promise<NextResponse> {
  const url = req.nextUrl;
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const error = url.searchParams.get("error");

  if (error) {
    return NextResponse.redirect(
      new URL(`/accounts?error=${encodeURIComponent(error)}`, req.url),
    );
  }

  if (!code || !state) {
    return NextResponse.redirect(
      new URL("/accounts?error=missing_parameters", req.url),
    );
  }

  try {
    assertGoogleOAuthConfig();
  } catch (configError) {
    console.error("Google OAuth is not configured:", configError);
    return NextResponse.redirect(
      new URL("/accounts?error=configuration_error", req.url),
    );
  }

  // Verify state and extract PKCE verifier
  const cookieStore = await cookies();
  const encryptedState = cookieStore.get("google_oauth_state")?.value;

  if (!encryptedState) {
    return NextResponse.redirect(
      new URL("/accounts?error=missing_cookie", req.url),
    );
  }

  let cookieData: { verifier: string; state: string; clerkUserId: string };
  try {
    const decrypted = decryptState(encryptedState);
    cookieData = JSON.parse(decrypted);
  } catch (_err) {
    return NextResponse.redirect(
      new URL("/accounts?error=invalid_cookie", req.url),
    );
  }

  if (state !== cookieData.state) {
    return NextResponse.redirect(
      new URL("/accounts?error=state_mismatch", req.url),
    );
  }

  if (!cookieData.clerkUserId) {
    cookieStore.delete("google_oauth_state");
    return NextResponse.redirect(
      new URL("/accounts?error=invalid_cookie", req.url),
    );
  }

  // Google redirects the browser here, so a Clerk session may or may not be
  // present (this route is public in the proxy for exactly that reason). When
  // one *is* present it must match the user who started the flow, otherwise a
  // stale cookie from an earlier account could link a Google account into the
  // wrong dashboard.
  const { userId: sessionUserId } = await auth();
  if (sessionUserId && sessionUserId !== cookieData.clerkUserId) {
    cookieStore.delete("google_oauth_state");
    return NextResponse.redirect(
      new URL("/accounts?error=session_mismatch", req.url),
    );
  }

  const clerkUserId = cookieData.clerkUserId;

  try {
    // Exchange code for tokens
    const tokenResponse = await fetch(GOOGLE_OAUTH.tokenUrl, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: GOOGLE_OAUTH.clientId,
        client_secret: GOOGLE_OAUTH.clientSecret,
        code,
        grant_type: "authorization_code",
        redirect_uri: GOOGLE_OAUTH.redirectUri,
        code_verifier: cookieData.verifier,
      }),
    });

    if (!tokenResponse.ok) {
      console.error("Token exchange failed:", tokenResponse.status);
      return NextResponse.redirect(
        new URL("/accounts?error=token_exchange_failed", req.url),
      );
    }

    const tokenData = (await tokenResponse.json()) as GoogleTokenResponse;
    const { access_token, refresh_token, expires_in } = tokenData;

    // Fetch user profile
    const profileResponse = await fetch(
      "https://www.googleapis.com/oauth2/v2/userinfo",
      {
        headers: { Authorization: `Bearer ${access_token}` },
      },
    );

    if (!profileResponse.ok) {
      console.error("Profile fetch failed:", profileResponse.status);
      return NextResponse.redirect(
        new URL("/accounts?error=profile_fetch_failed", req.url),
      );
    }

    const profileData = (await profileResponse.json()) as GoogleUserInfo;
    const email = profileData.email;
    const name = profileData.name || null;

    // Deliberately authorized service-role path.
    //
    // RLS is not usable here: Google performs a cross-site redirect, so there
    // is no guarantee of a live Clerk session (and therefore no
    // `auth().getToken()`) on this request. An RLS-scoped client would fall
    // back to anonymous and every write below would silently fail.
    //
    // The authorization that replaces it is the `google_oauth_state` cookie:
    // httpOnly, AES-256-GCM authenticated encryption with a server-only key,
    // and its `state` was matched against the one Google echoed back. It is
    // therefore unforgeable proof that `clerkUserId` started this flow. Every
    // statement below is explicitly scoped to that id so the elevated client
    // can only ever touch that user's rows.
    const supabase = createServiceClient();

    // Check if account already exists
    const { data: existingAccount, error: existingError } = await supabase
      .from("google_accounts")
      .select("id, is_active")
      .eq("clerk_user_id", clerkUserId)
      .eq("email", email)
      .single();

    if (existingError && existingError.code !== "PGRST116") {
      // PGRST116 is "No rows found"
      console.error("Existing account lookup failed:", existingError);
      return NextResponse.redirect(
        new URL("/accounts?error=account_lookup_failed", req.url),
      );
    }

    let accountId: string;

    if (existingAccount) {
      accountId = existingAccount.id;
      // Update display name and active status if needed
      const { error: updateError } = await supabase
        .from("google_accounts")
        .update({
          display_name: name,
          token_status: "active",
        })
        .eq("id", accountId)
        .eq("clerk_user_id", clerkUserId);

      if (updateError) {
        console.error("Account update failed:", updateError);
        return NextResponse.redirect(
          new URL("/accounts?error=account_update_failed", req.url),
        );
      }
    } else {
      // Check if user has any active accounts
      const { count, error: countError } = await supabase
        .from("google_accounts")
        .select("id", { count: "exact", head: true })
        .eq("clerk_user_id", clerkUserId)
        .eq("is_active", true);

      if (countError) {
        console.error("Active accounts count failed:", countError);
        return NextResponse.redirect(
          new URL("/accounts?error=account_count_failed", req.url),
        );
      }

      const isFirstAccount = count === 0;

      // Insert new account
      const { data: newAccount, error: insertError } = await supabase
        .from("google_accounts")
        .insert({
          clerk_user_id: clerkUserId,
          email,
          display_name: name,
          is_active: isFirstAccount,
          token_status: "active",
        })
        .select("id")
        .single();

      if (insertError || !newAccount) {
        console.error("Account insert failed:", insertError);
        return NextResponse.redirect(
          new URL("/accounts?error=account_creation_failed", req.url),
        );
      }

      accountId = newAccount.id;
    }

    let finalRefreshToken = refresh_token;

    if (!finalRefreshToken && existingAccount) {
      // Fetch the decrypted old refresh token securely via Supabase Vault RPC
      const { data: oldToken, error: rpcError } = await supabase.rpc(
        "get_decrypted_refresh_token",
        { p_account_id: accountId },
      );

      if (rpcError) {
        console.error("Failed to fetch old refresh token via RPC:", rpcError);
      } else if (oldToken) {
        finalRefreshToken = oldToken;
      }
    }

    if (!finalRefreshToken) {
      return NextResponse.redirect(
        new URL("/accounts?error=missing_refresh_token", req.url),
      );
    }

    const expiresAt = new Date(
      Date.now() + (Number(expires_in) || 3599) * 1000,
    ).toISOString();

    // Securely upsert tokens using Supabase Vault via RPC
    const { error: vaultError } = await supabase.rpc("upsert_google_tokens", {
      p_account_id: accountId,
      p_access_token: access_token,
      p_refresh_token: finalRefreshToken,
      p_expires_at: expiresAt,
    });

    if (vaultError) {
      console.error("Vault token save failed:", vaultError);
      return NextResponse.redirect(
        new URL("/accounts?error=token_save_failed", req.url),
      );
    }

    // Clear OAuth cookie
    cookieStore.delete("google_oauth_state");

    return NextResponse.redirect(
      new URL("/accounts?success=account_linked", req.url),
    );
  } catch (error) {
    console.error("OAuth callback unexpected error:", error);
    return NextResponse.redirect(
      new URL("/accounts?error=unexpected_error", req.url),
    );
  }
}
