import crypto from "node:crypto";
import { auth } from "@clerk/nextjs/server";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { GOOGLE_OAUTH } from "@/lib/google/oauth-config";
import { encryptToken as encryptState } from "@/lib/google/state-crypto";

export async function GET() {
  const { userId } = await auth();

  if (!userId) {
    redirect("/sign-in");
  }

  // Generate PKCE verifier and challenge
  const verifier = crypto.randomBytes(32).toString("base64url");
  const challenge = crypto
    .createHash("sha256")
    .update(verifier)
    .digest("base64url");

  // Generate state
  const state = crypto.randomBytes(16).toString("hex");

  // Store in encrypted cookie
  const cookieData = JSON.stringify({ verifier, state, clerkUserId: userId });
  const encryptedCookieData = encryptState(cookieData);

  const cookieStore = await cookies();
  cookieStore.set("google_oauth_state", encryptedCookieData, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 60 * 10, // 10 minutes
    path: "/",
  });

  // Build Google OAuth URL
  const params = new URLSearchParams({
    client_id: GOOGLE_OAUTH.clientId,
    redirect_uri: GOOGLE_OAUTH.redirectUri,
    response_type: "code",
    scope: GOOGLE_OAUTH.scopes.join(" "),
    access_type: "offline",
    prompt: "consent",
    state: state,
    code_challenge: challenge,
    code_challenge_method: "S256",
  });

  const authUrl = `${GOOGLE_OAUTH.authUrl}?${params.toString()}`;

  redirect(authUrl);
}
