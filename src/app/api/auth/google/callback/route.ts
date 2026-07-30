import { cookies } from "next/headers";
import { type NextRequest, NextResponse } from "next/server";
import { GOOGLE_OAUTH } from "@/lib/google/oauth-config";
import { decryptToken, encryptToken } from "@/lib/google/token-crypto";
import { createServerClient } from "@/lib/supabase/server";

export async function GET(req: NextRequest) {
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
    const decrypted = decryptToken(encryptedState);
    cookieData = JSON.parse(decrypted);
  } catch (err) {
    return NextResponse.redirect(
      new URL("/accounts?error=invalid_cookie", req.url),
    );
  }

  if (state !== cookieData.state) {
    return NextResponse.redirect(
      new URL("/accounts?error=state_mismatch", req.url),
    );
  }

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
    console.error("Token exchange failed:", await tokenResponse.text());
    return NextResponse.redirect(
      new URL("/accounts?error=token_exchange_failed", req.url),
    );
  }

  const tokenData = await tokenResponse.json();
  const { access_token, refresh_token, expires_in } = tokenData;

  // Fetch user profile
  const profileResponse = await fetch(
    "https://www.googleapis.com/oauth2/v2/userinfo",
    {
      headers: { Authorization: `Bearer ${access_token}` },
    },
  );

  if (!profileResponse.ok) {
    console.error("Profile fetch failed:", await profileResponse.text());
    return NextResponse.redirect(
      new URL("/accounts?error=profile_fetch_failed", req.url),
    );
  }

  const profileData = await profileResponse.json();
  const email = profileData.email;
  const name = profileData.name || null;

  // Connect to Supabase
  const supabase = await createServerClient();

  // Check if account already exists
  const { data: existingAccount } = await supabase
    .from("google_accounts")
    .select("id, is_active")
    .eq("clerk_user_id", cookieData.clerkUserId)
    .eq("email", email)
    .single();

  let accountId: string;

  if (existingAccount) {
    accountId = existingAccount.id;
    // Update display name and active status if needed
    await supabase
      .from("google_accounts")
      .update({
        display_name: name,
        token_status: "active",
      })
      .eq("id", accountId);
  } else {
    // Check if user has any active accounts
    const { count } = await supabase
      .from("google_accounts")
      .select("id", { count: "exact", head: true })
      .eq("clerk_user_id", cookieData.clerkUserId)
      .eq("is_active", true);

    const isFirstAccount = count === 0;

    // Insert new account
    const { data: newAccount, error: insertError } = await supabase
      .from("google_accounts")
      .insert({
        clerk_user_id: cookieData.clerkUserId,
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

  // We need the refresh token. Google only returns refresh_token on the first authorization
  // (unless prompt=consent is used, which we do, so it should be there, but fallback just in case).
  let finalRefreshToken = refresh_token;

  if (!finalRefreshToken && existingAccount) {
    const { data: oldToken } = await supabase
      .from("google_tokens")
      .select("refresh_token_encrypted")
      .eq("account_id", accountId)
      .single();

    if (oldToken) {
      try {
        finalRefreshToken = decryptToken(oldToken.refresh_token_encrypted);
      } catch (e) {
        console.error("Failed to decrypt old refresh token");
      }
    }
  }

  if (!finalRefreshToken) {
    return NextResponse.redirect(
      new URL("/accounts?error=missing_refresh_token", req.url),
    );
  }

  // Encrypt tokens
  const encryptedAccessToken = encryptToken(access_token);
  const encryptedRefreshToken = encryptToken(finalRefreshToken);
  const expiresAt = new Date(Date.now() + expires_in * 1000).toISOString();

  // Upsert tokens
  const { error: tokenError } = await supabase.from("google_tokens").upsert({
    account_id: accountId,
    access_token_encrypted: encryptedAccessToken,
    refresh_token_encrypted: encryptedRefreshToken,
    expires_at: expiresAt,
    updated_at: new Date().toISOString(),
  });

  if (tokenError) {
    console.error("Token save failed:", tokenError);
    return NextResponse.redirect(
      new URL("/accounts?error=token_save_failed", req.url),
    );
  }

  // Clear OAuth cookie
  cookieStore.delete("google_oauth_state");

  return NextResponse.redirect(
    new URL("/accounts?success=account_linked", req.url),
  );
}
