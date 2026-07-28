import "server-only";
import { getSupabasePublicEnv } from "./env";

export function requireSupabaseServiceEnv() {
  const { url } = getSupabasePublicEnv();
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url) throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL");
  if (!serviceKey) throw new Error("Missing SUPABASE_SERVICE_ROLE_KEY");
  return { url, serviceKey };
}
