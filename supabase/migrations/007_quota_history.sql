CREATE TABLE public.quota_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID REFERENCES public.google_accounts(id) ON DELETE CASCADE,
  timestamp TIMESTAMPTZ DEFAULT NOW(),
  plan_type TEXT,
  prompt_credits_available INTEGER,
  prompt_credits_monthly INTEGER,
  snapshot_data JSONB NOT NULL
);

CREATE TABLE public.model_quota_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  snapshot_id UUID REFERENCES public.quota_snapshots(id) ON DELETE CASCADE,
  model_id TEXT NOT NULL,
  label TEXT NOT NULL,
  remaining_percentage NUMERIC(5,4),
  is_exhausted BOOLEAN,
  reset_time TIMESTAMPTZ
);

CREATE INDEX idx_snapshots_time
  ON public.quota_snapshots (account_id, timestamp DESC);

ALTER TABLE public.quota_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.model_quota_history ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read their own quota snapshots" ON public.quota_snapshots
  FOR SELECT TO authenticated USING (
    EXISTS (SELECT 1 FROM public.google_accounts WHERE id = quota_snapshots.account_id AND clerk_user_id = requesting_user_id())
  );

CREATE POLICY "Users can insert their own quota snapshots" ON public.quota_snapshots
  FOR INSERT TO authenticated WITH CHECK (
    EXISTS (SELECT 1 FROM public.google_accounts WHERE id = quota_snapshots.account_id AND clerk_user_id = requesting_user_id())
  );

CREATE POLICY "Users can read their own model history" ON public.model_quota_history
  FOR SELECT TO authenticated USING (
    EXISTS (
      SELECT 1 FROM public.quota_snapshots
      JOIN public.google_accounts ON google_accounts.id = quota_snapshots.account_id
      WHERE quota_snapshots.id = model_quota_history.snapshot_id
      AND clerk_user_id = requesting_user_id()
    )
  );

CREATE POLICY "Users can insert their own model history" ON public.model_quota_history
  FOR INSERT TO authenticated WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.quota_snapshots
      JOIN public.google_accounts ON google_accounts.id = quota_snapshots.account_id
      WHERE quota_snapshots.id = model_quota_history.snapshot_id
      AND clerk_user_id = requesting_user_id()
    )
  );
