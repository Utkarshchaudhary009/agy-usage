import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";

const isPublicRoute = createRouteMatcher([
  "/sign-in(.*)",
  "/sign-up(.*)",
  "/", // Landing page
  "/api/inngest(.*)", // Inngest webhook endpoint
  "/api/health(.*)", // Unauthenticated liveness probe
  // Google OAuth callback: Google performs a cross-site redirect here, so a
  // live Clerk session is not guaranteed and auth.protect() would bounce a
  // legitimate callback to the sign-in page (losing the one-time code).
  // The route authorizes itself instead: it verifies the signed, httpOnly
  // `google_oauth_state` cookie (AES-256-GCM: state + PKCE verifier +
  // clerkUserId), matches `state` against Google's echo, and then writes via a
  // service-role client scoped to that clerkUserId.
  "/api/auth/google/callback(.*)",
]);

export const proxy = clerkMiddleware(async (auth, req) => {
  if (!isPublicRoute(req)) {
    await auth.protect();
  }
});

export const config = {
  matcher: [
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    "/(api|trpc)(.*)",
  ],
};
