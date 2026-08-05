import { NextResponse } from "next/server";

/**
 * Liveness probe.
 *
 * `export const dynamic = "force-dynamic"` is deliberately not used: since
 * Next.js 15 `GET` Route Handlers are already dynamic by default, so the flag
 * is a no-op here. What actually matters for a health check is that no proxy
 * or CDN in front of the app serves a cached "ok" for a dead instance, which
 * is what the explicit `Cache-Control` header below guarantees.
 */
export function GET() {
  return NextResponse.json(
    { status: "ok" },
    { headers: { "Cache-Control": "no-store" } },
  );
}
