import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Keep server SDKs out of the Server Component/Route Handler bundle so Vercel's
  // function tracer uses native `require` instead of trying to trace and inline
  // packages that shell out to Node internals (Supabase, Inngest, Upstash).
  // Without this, Vercel builds can fail with "A required dependency could not
  // be bundled" or unresolved dynamic requires during function tracing.
  // (@clerk/nextjs is intentionally NOT listed here: externalizing it breaks the
  // build because its client-boundary modules can't be resolved as externals.)
  serverExternalPackages: [
    "@supabase/supabase-js",
    "inngest",
    "@upstash/redis",
    "@upstash/ratelimit",
  ],
};

export default nextConfig;
