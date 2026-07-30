-- supabase/migrations/002_quota_cache.sql

CREATE TABLE public.quota_cache (
  account_id UUID REFERENCES public.google_accounts(id) ON DELETE CASCADE PRIMARY KEY,
  snapshot JSONB NOT NULL,
  cached_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_quota_cache_time ON public.quota_cache (cached_at);

-- Enable RLS
ALTER TABLE public.quota_cache ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage their own quota cache" ON public.quota_cache
  FOR ALL TO authenticated USING (
    EXISTS (SELECT 1 FROM public.google_accounts WHERE id = quota_cache.account_id AND clerk_user_id = requesting_user_id())
  );
