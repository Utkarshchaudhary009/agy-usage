import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Keep server SDKs out of the Server Component/Route Handler bundle so Vercel's
  // function tracer uses native `require` instead of trying to trace and inline
  // packages that shell out to Node internals (Clerk, Supabase, Inngest, Upstash).
  // Without this, Vercel builds can fail with "A required dependency could not
  // be bundled" or unresolved dynamic requires during function tracing.
  serverExternalPackages: [
    "@supabase/supabase-js",
    "inngest",
    "@upstash/redis",
    "@upstash/ratelimit",
  ],
};

export default nextConfig;
