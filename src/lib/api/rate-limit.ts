import "server-only";

import { type Duration, Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";
import type { NextResponse } from "next/server";
import { errorJson } from "./accounts";

// Rate limiting is shared infrastructure: every expensive authenticated
// endpoint (anything that reaches Google, refreshes a token, or burns account
// quota) must go through here. Limiters are memoized per bucket so a route
// module does not open a new Redis client on every request.
let redis: Redis | undefined;
let redisResolved = false;
const limiters = new Map<string, Ratelimit>();

function getRedis(): Redis | undefined {
  if (redisResolved) return redis;
  redisResolved = true;

  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;

  if (!url || !token) {
    console.warn(
      "Upstash rate limiting is not configured. UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN must be set to enable rate limiting.",
    );
    return undefined;
  }

  redis = new Redis({ url, token });
  return redis;
}

function getLimiter(
  bucket: string,
  limit: number,
  window: Duration,
): Ratelimit | undefined {
  // Key on the full config, not just the bucket: two call sites sharing a
  // bucket name with different limits must never silently inherit whichever
  // limiter was memoized first.
  const cacheKey = `${bucket}:${limit}:${window}`;
  const cached = limiters.get(cacheKey);
  if (cached) return cached;

  const client = getRedis();
  if (!client) return undefined;

  const limiter = new Ratelimit({
    redis: client,
    limiter: Ratelimit.slidingWindow(limit, window),
    analytics: false,
    prefix: `ratelimit_${bucket}`,
  });
  limiters.set(cacheKey, limiter);
  return limiter;
}

export interface RateLimitOptions {
  /** Logical bucket, e.g. "wakeup_trigger". Keeps windows independent. */
  bucket: string;
  /** Per-caller key. Always a Clerk user id, never client-supplied input. */
  identifier: string;
  limit: number;
  window: Duration;
  /** User-facing message. Must not disclose internal state. */
  message: string;
}

/**
 * Returns a 429 response when the caller is over budget, otherwise null.
 *
 * Fails open on Redis errors and when Upstash is unconfigured (matching the
 * rest of the codebase): a rate limiter outage must not take the product down.
 * Unconfigured deployments are surfaced through the one-time warning emitted
 * by getRedis() on first use.
 */
export async function enforceRateLimit(
  options: RateLimitOptions,
): Promise<NextResponse | null> {
  const limiter = getLimiter(options.bucket, options.limit, options.window);
  if (!limiter) return null;

  try {
    const { success, reset } = await limiter.limit(options.identifier);
    if (success) return null;

    const retryAfterSeconds = Math.max(
      1,
      Math.ceil((reset - Date.now()) / 1000),
    );

    return errorJson(
      {
        error: "Rate Limit Exceeded",
        code: "RATE_LIMIT_EXCEEDED",
        message: options.message,
      },
      429,
      { "Retry-After": String(retryAfterSeconds) },
    );
  } catch (err) {
    console.error("Failed to check rate limit, failing open:", err);
    return null;
  }
}
