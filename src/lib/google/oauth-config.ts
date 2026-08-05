import "server-only";

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing ${name} environment variable`);
  }
  return value;
}

let cachedClientId: string | undefined;
let cachedClientSecret: string | undefined;
let cachedRedirectUri: string | undefined;

export const GOOGLE_OAUTH = {
  get clientId(): string {
    if (cachedClientId === undefined) {
      cachedClientId = requireEnv("GOOGLE_CLIENT_ID");
    }
    return cachedClientId;
  },
  get clientSecret(): string {
    if (cachedClientSecret === undefined) {
      cachedClientSecret = requireEnv("GOOGLE_CLIENT_SECRET");
    }
    return cachedClientSecret;
  },
  authUrl: "https://accounts.google.com/o/oauth2/v2/auth",
  tokenUrl: "https://oauth2.googleapis.com/token",
  scopes: [
    "https://www.googleapis.com/auth/cloud-platform",
    "https://www.googleapis.com/auth/userinfo.email",
  ],
  get redirectUri(): string {
    if (cachedRedirectUri === undefined) {
      cachedRedirectUri = `${requireEnv("NEXT_PUBLIC_APP_URL")}/api/auth/google/callback`;
    }
    return cachedRedirectUri;
  },
};
