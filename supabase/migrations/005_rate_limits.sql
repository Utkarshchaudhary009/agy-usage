-- supabase/migrations/005_rate_limits.sql

CREATE TABLE public.rate_limits (
  clerk_user_id TEXT PRIMARY KEY,
  timestamps TIMESTAMPTZ[] DEFAULT '{}'
);

ALTER TABLE public.rate_limits ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage their own rate limits" ON public.rate_limits
  FOR ALL TO authenticated USING (
    clerk_user_id = requesting_user_id()
  );
