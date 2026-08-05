import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";

const isPublicRoute = createRouteMatcher([
  "/sign-in(.*)",
  "/sign-up(.*)",
  "/", // Landing page
  "/api/inngest(.*)", // Inngest webhook endpoint
  "/api/health(.*)", // Unauthenticated liveness probe
  // Google OAuth callback: Google redirects here without a live Clerk
  // session. The request is authenticated via the signed, httpOnly
  // `google_oauth_state` cookie (state + PKCE verifier + clerkUserId),
  // so it must not be gated by auth.protect().
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
