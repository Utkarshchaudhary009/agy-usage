import "server-only";

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing ${name} environment variable`);
  }
  return value;
}

export const GOOGLE_OAUTH = {
  get clientId(): string {
    return requireEnv("GOOGLE_CLIENT_ID");
  },
  get clientSecret(): string {
    return requireEnv("GOOGLE_CLIENT_SECRET");
  },
  authUrl: "https://accounts.google.com/o/oauth2/v2/auth",
  tokenUrl: "https://oauth2.googleapis.com/token",
  scopes: [
    "https://www.googleapis.com/auth/cloud-platform",
    "https://www.googleapis.com/auth/userinfo.email",
  ],
  get redirectUri(): string {
    return `${requireEnv("NEXT_PUBLIC_APP_URL")}/api/auth/google/callback`;
  },
};
