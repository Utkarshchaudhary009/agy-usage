import "server-only";

/**
 * Validates a required environment variable at the point of use.
 *
 * The value is passed in by the caller rather than looked up as
 * `process.env[name]` on purpose: Next.js only inlines *static* `process.env.X`
 * references at build time, so dynamic lookups silently resolve to `undefined`
 * in bundled runtimes (Edge, and any `NEXT_PUBLIC_*` read).
 */
function requireEnv(name: string, value: string | undefined): string {
  if (!value) {
    throw new Error(`Missing ${name} environment variable`);
  }
  return value;
}

export const GOOGLE_OAUTH = {
  get clientId(): string {
    return requireEnv("GOOGLE_CLIENT_ID", process.env.GOOGLE_CLIENT_ID);
  },
  get clientSecret(): string {
    return requireEnv("GOOGLE_CLIENT_SECRET", process.env.GOOGLE_CLIENT_SECRET);
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
    return `${requireEnv("NEXT_PUBLIC_APP_URL", process.env.NEXT_PUBLIC_APP_URL)}/api/auth/google/callback`;
  },
} as const;
