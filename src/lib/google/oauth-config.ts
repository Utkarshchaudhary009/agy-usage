import "server-only";

/**
 * A required OAuth environment variable is missing or empty.
 *
 * Distinct from runtime/network failures on purpose: this is a deployment
 * defect, so callers (notably the token-refresh retry loop) must fail fast
 * instead of retrying with backoff and reporting it as a network error.
 */
export class OAuthConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OAuthConfigError";
  }
}

/**
 * Validates a required environment variable at the point of use.
 *
 * The value is passed in by the caller rather than looked up as
 * `process.env[name]` on purpose: Next.js only inlines *static* `process.env.X`
 * references at build time, so dynamic lookups silently resolve to `undefined`
 * in bundled runtimes (Edge, and any `NEXT_PUBLIC_*` read).
 *
 * The getters below deliberately do NOT throw when a variable is missing. They
 * are evaluated while Next.js collects route metadata at build time (and when
 * the module graph is traced), so a throwing getter would surface as a hard
 * build failure on hosts that don't inject every OAuth var at build (e.g.
 * Vercel). Instead the getters return an empty string and the fail-fast check
 * lives in `assertGoogleOAuthConfig()`, which entry points call before doing
 * any OAuth work — so a misconfigured deployment still fails clearly, just at
 * request time rather than build time.
 */
function requireEnv(name: string, value: string | undefined): string {
  if (!value) {
    throw new OAuthConfigError(`Missing ${name} environment variable`);
  }
  return value;
}

export const GOOGLE_OAUTH = {
  get clientId(): string {
    return process.env.GOOGLE_CLIENT_ID ?? "";
  },
  get clientSecret(): string {
    return process.env.GOOGLE_CLIENT_SECRET ?? "";
  },
  authUrl: "https://accounts.google.com/o/oauth2/v2/auth",
  tokenUrl: "https://oauth2.googleapis.com/token",
  // Frozen: module scope is shared by every request in a server runtime, so a
  // mutable array here would let one request's mutation leak into all others.
  scopes: Object.freeze([
    "https://www.googleapis.com/auth/cloud-platform",
    "https://www.googleapis.com/auth/userinfo.email",
  ]),
  get redirectUri(): string {
    return `${process.env.NEXT_PUBLIC_APP_URL ?? ""}/api/auth/google/callback`;
  },
} as const;

/**
 * Eagerly validates every OAuth environment variable.
 *
 * Call this at the top of an OAuth entry point so a misconfigured deployment
 * surfaces as one clear `OAuthConfigError` up front, rather than halfway
 * through a token exchange.
 *
 * @throws {OAuthConfigError} if any required variable is missing.
 */
export function assertGoogleOAuthConfig(): void {
  requireEnv("GOOGLE_CLIENT_ID", process.env.GOOGLE_CLIENT_ID);
  requireEnv("GOOGLE_CLIENT_SECRET", process.env.GOOGLE_CLIENT_SECRET);
  requireEnv("NEXT_PUBLIC_APP_URL", process.env.NEXT_PUBLIC_APP_URL);
}
